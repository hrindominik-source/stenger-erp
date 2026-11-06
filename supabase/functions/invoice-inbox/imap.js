// Maly IMAP klient len na to, co treba: LOGIN, EXAMINE (len citanie), UID SEARCH
// a UID FETCH s BODY.PEEK (neoznacuje ako precitane). Pracuje nad web streamami,
// takze bezi v Deno (Deno.connectTls) aj v Node (testy). Kniznica imapflow sa
// v Edge Functions nad TLS zasekavala pri FETCH, preto vlastna implementacia.

const enc = new TextEncoder();
const latin1 = new TextDecoder("latin1");
const MESIACE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function imapQuote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function imapDate(d) {
  return `${d.getUTCDate()}-${MESIACE[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export class MiniImap {
  constructor({ readable, writable, timeoutMs = 60_000 }) {
    this.reader = readable.getReader();
    this.writer = writable.getWriter();
    this.buf = new Uint8Array(0);
    this.n = 0;
    this.timeoutMs = timeoutMs;
  }

  async fill() {
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error("IMAP: server neodpovedá")), this.timeoutMs);
    });
    try {
      const { value, done } = await Promise.race([this.reader.read(), timeout]);
      if (done) throw new Error("IMAP: spojenie sa zatvorilo");
      this.buf = concat(this.buf, value instanceof Uint8Array ? value : new Uint8Array(value));
    } finally {
      clearTimeout(timer);
    }
  }

  async readLine() {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) {
        const line = this.buf.subarray(0, i > 0 && this.buf[i - 1] === 13 ? i - 1 : i);
        const s = latin1.decode(line);
        this.buf = this.buf.slice(i + 1);
        return s;
      }
      await this.fill();
    }
  }

  async readBytes(n) {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  // Jedna odpoved servera vratane literalov {n}. text = riadky s vlozenym obsahom
  // malych literalov (pre regexy), literals = surove bajty kazdeho literalu.
  async readResponse() {
    let text = "";
    const literals = [];
    for (;;) {
      const line = await this.readLine();
      const m = line.match(/\{(\d+)\}$/);
      if (!m) {
        text += line;
        return { text, literals };
      }
      const lit = await this.readBytes(Number(m[1]));
      literals.push(lit);
      text += line.slice(0, -m[0].length) + (lit.length < 4096 ? imapQuote(latin1.decode(lit)) : `"<literal ${literals.length - 1}>"`);
    }
  }

  async greeting() {
    const r = await this.readResponse();
    if (!/^\* (OK|PREAUTH)/i.test(r.text)) throw new Error("IMAP: neočakávaný pozdrav servera");
  }

  async cmd(command, { secret } = {}) {
    const tag = "A" + ++this.n;
    await this.writer.write(enc.encode(`${tag} ${command}\r\n`));
    const untagged = [];
    for (;;) {
      const r = await this.readResponse();
      if (r.text.startsWith(tag + " ")) {
        if (!/^\S+ OK/i.test(r.text)) throw new Error(`IMAP ${secret || command.split(" ")[0]}: ${r.text.slice(tag.length + 1, 200)}`);
        return untagged;
      }
      untagged.push(r);
    }
  }

  async login(user, pass) {
    await this.cmd(`LOGIN ${imapQuote(user)} ${imapQuote(pass)}`, { secret: "LOGIN" });
  }

  async examine(box = "INBOX") {
    const res = await this.cmd(`EXAMINE ${imapQuote(box)}`);
    const uv = res.map((r) => r.text.match(/UIDVALIDITY (\d+)/i)).find(Boolean);
    this.uidValidity = uv ? uv[1] : "";
  }

  async searchSince(date) {
    const res = await this.cmd(`UID SEARCH SINCE ${imapDate(date)}`);
    const line = res.find((r) => /^\* SEARCH/i.test(r.text));
    return line ? line.text.replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter(Boolean).map(Number) : [];
  }

  // Pre kazdy mail: uid, velkost, Message-ID a ci BODYSTRUCTURE obsahuje PDF.
  async overview(uids) {
    if (uids.length === 0) return [];
    const res = await this.cmd(`UID FETCH ${uids.join(",")} (UID RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])`);
    return res
      .filter((r) => /^\* \d+ FETCH/i.test(r.text))
      .map((r) => {
        const uid = Number((r.text.match(/UID (\d+)/i) || [])[1]);
        const size = Number((r.text.match(/RFC822\.SIZE (\d+)/i) || [])[1] || 0);
        const bs = (r.text.match(/BODYSTRUCTURE ([\s\S]*?) BODY\[/i) || r.text.match(/BODYSTRUCTURE ([\s\S]*)$/i) || [])[1] || "";
        const hdr = r.literals.length ? latin1.decode(r.literals[r.literals.length - 1]) : "";
        const messageId = ((hdr.match(/^Message-ID:\s*(.+)$/im) || [])[1] || "").trim();
        return { uid, size, messageId, maPdf: /"application"\s+"(x-)?pdf"|\.pdf"/i.test(bs) };
      });
  }

  async message(uid) {
    const res = await this.cmd(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    const r = res.find((x) => /^\* \d+ FETCH/i.test(x.text) && x.literals.length);
    if (!r) throw new Error("IMAP: mail sa nepodarilo stiahnuť");
    return r.literals[r.literals.length - 1];
  }

  async logout() {
    try {
      await this.cmd("LOGOUT");
    } catch {
      // server po BYE moze spojenie hned zavriet
    }
  }
}
