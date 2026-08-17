import React, { useState, useEffect, useCallback, useRef } from "react";
import { LogOut, Loader2, AlertCircle, PackageCheck, PackageX, Check, TriangleAlert, XCircle, Trash2, CheckCircle2, Camera, X, ChevronRight, Truck, PackagePlus, Warehouse, LayoutDashboard } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { extractCityFromAddress, todayStr, nowTimeStr, formatDateTime, uid, parseSkDate } from "./lib/utils.js";
import { computeStockLevels, computeFinishedGoodsStock, wouldExceed, extraKnownMaterials, UNIT_QUICK_PICKS } from "./lib/inventory.js";

const POLL_MS = 4000;
const MATERIAL_QUICK_PICKS = ["Kukuřice Mushroom Yellow", "Cukr Tereos krystal", "Sůl SUPERFINE", "Tuk AKOSNAC NT MB", "Kartony", "Kbelíky", "Fólie", "Střešní fólie", "Pásky"];
const STOCK_ISSUE_REASONS = ["Vyroba", "Testovanie/vzorky", "Znehodnotene", "Ine"];
const GOODS_RECEIPT_PHOTOS_BUCKET = "goods-receipt-photos";
const EXPEDICIA_PHOTOS_BUCKET = "expedicia-photos";
const PRODUCTION_LINKY = [
  { value: "sacky", label: "Sáčky" },
  { value: "kyble", label: "Kbelíky" },
  { value: "bulk", label: "Bulk" },
];

function productLabel(p) {
  if (!p) return "";
  return [p.znacka, [p.gramaz, p.ksVKartone, p.kartonovNaPalete].filter(Boolean).join("/")].filter(Boolean).join(" ");
}

function backdatedNote(createdAt, businessDate) {
  if (!createdAt || !businessDate) return "";
  const m = String(businessDate).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return "";
  const created = new Date(createdAt);
  const sameDay =
    created.getDate() === parseInt(m[1], 10) &&
    created.getMonth() + 1 === parseInt(m[2], 10) &&
    created.getFullYear() === parseInt(m[3], 10);
  if (sameDay) return "";
  return " (zapsáno dodatečně " + formatDateTime(createdAt) + ")";
}

async function openBucketPhoto(bucket, path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (!error && data) window.open(data.signedUrl, "_blank");
}
function openGoodsReceiptPhoto(path) {
  return openBucketPhoto(GOODS_RECEIPT_PHOTOS_BUCKET, path);
}
function openExpediciaPhoto(path) {
  return openBucketPhoto(EXPEDICIA_PHOTOS_BUCKET, path);
}
async function uploadExpediciaPhoto(orderId, formId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${orderId}/${formId}.${ext}`;
  const { error } = await supabase.storage.from(EXPEDICIA_PHOTOS_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return path;
}

export default function SkladView({ fullName, onSignOut }) {
  const [tab, setTab] = useState("prehlad");
  const [skladWorkers, setSkladWorkers] = useState([]);
  const [pracovnik, setPracovnik] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("workers").select("*");
      if (!cancelled && !error) {
        const list = (data || []).map((row) => row.data).filter((w) => w.typ === "sklad");
        setSkladWorkers(list);
        setPracovnik((prev) => prev || (list.some((w) => w.meno === "Martin Dostál") ? "Martin Dostál" : prev));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeMeno = pracovnik || fullName;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header className="bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
            <div>
              <div className="text-xs tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
              <div className="text-lg font-semibold">Sklad</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">{activeMeno}</span>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 text-slate-300 hover:bg-slate-800 px-3 py-1.5 rounded-md text-sm"
            >
              <LogOut size={16} /> Odhlásit
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-4">
          <nav className="flex items-stretch gap-2 mt-1 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-2 shadow-inner">
            <SkladTabButton active={tab === "prehlad"} onClick={() => setTab("prehlad")} color="prehlad" icon={<LayoutDashboard size={20} />} label="Přehled" />
            <SkladTabButton active={tab === "expedicia"} onClick={() => setTab("expedicia")} color="expedicia" icon={<Truck size={20} />} label="Expedice" />
            <SkladTabButton active={tab === "prijem"} onClick={() => setTab("prijem")} color="prijem" icon={<PackagePlus size={20} />} label="Příjem zboží" />
            <SkladTabButton active={tab === "zasoby"} onClick={() => setTab("zasoby")} color="zasoby" icon={<Warehouse size={20} />} label="Zásoby" />
          </nav>
        </div>
      </header>

      {tab !== "prehlad" && skladWorkers.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-xs font-medium text-slate-500 mb-2">Kdo pracuje</div>
            <div className="flex gap-2 flex-wrap">
              {skladWorkers.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setPracovnik(w.meno)}
                  className={"text-sm font-semibold px-3 py-2 rounded-lg border-2 " + (activeMeno === w.meno ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}
                >
                  {w.meno}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6">
        {tab === "prehlad" ? <PrehladTab /> : tab === "expedicia" ? <ExpediciaTab fullName={activeMeno} /> : tab === "prijem" ? <PrijemTab fullName={pracovnik} /> : <ZasobyTab fullName={activeMeno} />}
      </main>
    </div>
  );
}

/* ---------------- Expedicia ---------------- */

const SKLAD_TAB_COLORS = {
  prehlad: { badge: "from-teal-400 to-teal-600", shadow: "shadow-teal-500/40" },
  expedicia: { badge: "from-blue-400 to-blue-600", shadow: "shadow-blue-500/40" },
  prijem: { badge: "from-emerald-400 to-emerald-600", shadow: "shadow-emerald-500/40" },
  zasoby: { badge: "from-violet-400 to-violet-600", shadow: "shadow-violet-500/40" },
};

function SkladTabButton({ active, onClick, color, icon, label }) {
  const c = SKLAD_TAB_COLORS[color] || SKLAD_TAB_COLORS.expedicia;
  return (
    <button
      onClick={onClick}
      className={
        "group relative flex-1 flex flex-col items-center justify-center gap-1.5 py-3.5 px-2 rounded-xl text-base font-bold text-center leading-tight transition-all duration-200 " +
        (active
          ? "bg-gradient-to-b from-white to-slate-50 text-slate-900 shadow-lg " + c.shadow + " -translate-y-0.5"
          : "text-slate-300 hover:text-white hover:bg-white/5 hover:-translate-y-0.5")
      }
    >
      <span className={"flex items-center justify-center w-11 h-11 rounded-lg bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110 " + c.badge}>
        {icon}
      </span>
      {label}
    </button>
  );
}

/* ---------------- Prehlad ---------------- */

function PrehladTab() {
  const [orders, setOrders] = useState([]);
  const [plan, setPlan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const [ordersRes, planRes] = await Promise.all([
      supabase.rpc("get_orders_for_sklad"),
      supabase.from("production_plan").select("*"),
    ]);
    if (ordersRes.error || planRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setOrders(ordersRes.data || []);
    setPlan((planRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    pollRef.current = setInterval(fetchAll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-10">
        <Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...
      </div>
    );
  }

  const pending = orders.filter((o) => o.stav_expedicie !== "Expedovana");
  const sortedPlan = plan
    .slice()
    .sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0));

  return (
    <div>
      {error && <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 mb-1">Čeká na expedici</div>
          <div className="text-3xl font-bold text-amber-600">{pending.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 mb-1">Položky ve výrobním plánu</div>
          <div className="text-3xl font-bold text-teal-700">{plan.length}</div>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-500 mb-2">Výrobní plán</h2>
        {sortedPlan.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Žádné položky ve výrobním plánu.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {sortedPlan.map((r) => {
              const stav = r.stavVyroby || "caka";
              const stavLabel = stav === "hotovo" ? "Ukončeno" : stav === "prebieha" ? "Probíhá" : "Čeká";
              const stavClass = stav === "hotovo" ? "bg-emerald-100 text-emerald-700" : stav === "prebieha" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700";
              const zmenene = new Set(r.zmenenePolia || []);
              const jeZmenene = zmenene.size > 0 && r.zmeneneKedy && (Date.now() - new Date(r.zmeneneKedy).getTime()) < 24 * 60 * 60 * 1000;
              const zmCls = (pole) => (jeZmenene && zmenene.has(pole) ? "text-red-600 font-semibold" : "");
              return (
                <div key={r.id} className={"px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between gap-3 " + (jeZmenene ? "bg-red-50" : "")}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className={"font-medium text-sm truncate " + zmCls("produktNazov")}>{r.produktNazov}</div>
                      {jeZmenene && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Změněno</span>}
                    </div>
                    <div className="text-xs text-slate-400">
                      <span className={zmCls("mnozstvo") || zmCls("mnozstvoJednotka")}>{r.mnozstvo} {r.mnozstvoJednotka === "kartonov" ? "kartonů" : "palet"}</span>
                      {r.poznamka && <span className={zmCls("poznamka")}>{" - " + r.poznamka}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + stavClass}>{stavLabel}</span>
                    <span className={"text-sm " + (zmCls("datum") || "text-slate-600")}>{r.datum}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-2">Expedice - čeká na vyřízení</h2>
        {pending.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Vše vyřízeno.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {pending.map((o) => (
              <div key={o.id} className="px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{o.zakaznik || "-"}</div>
                  <div className="text-xs text-slate-400 truncate">{o.adresa_dodania_nazov}</div>
                </div>
                <div className="text-xs text-slate-500 whitespace-nowrap">{o.cislo_objednavky_dopravy}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Expedicia ---------------- */

function ExpediciaTab({ fullName }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [openOrderId, setOpenOrderId] = useState(null);
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const [ordersRes, productsRes, outputsRes, dispatchesRes, carriersRes] = await Promise.all([
      supabase.rpc("get_orders_for_sklad"),
      supabase.from("products").select("*"),
      supabase.from("production_outputs").select("*"),
      supabase.from("expedicia_zaznamy").select("*").order("created_at", { ascending: false }),
      supabase.from("carriers").select("*"),
    ]);
    if (ordersRes.error) {
      setError("Nepodařilo se načíst objednávky.");
      return;
    }
    setError("");
    setOrders(ordersRes.data || []);
    if (!productsRes.error) setProducts((productsRes.data || []).map((row) => row.data));
    if (!outputsRes.error) setOutputs((outputsRes.data || []).map((row) => row.data));
    if (!dispatchesRes.error) setDispatches((dispatchesRes.data || []).map((row) => ({ ...row.data, id: row.id, orderId: row.order_id, createdAt: row.created_at })));
    if (!carriersRes.error) setCarriers((carriersRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    pollRef.current = setInterval(fetchAll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  async function toggleExpedovana(order) {
    const next = order.stav_expedicie === "Expedovana" ? "Neexpedovana" : "Expedovana";
    setUpdatingId(order.id);
    const { error: rpcError } = await supabase.rpc("set_expedovana", { p_id: order.id, p_val: next });
    setUpdatingId(null);
    if (rpcError) {
      setError("Změna se nepodařila, zkuste to znovu.");
      return;
    }
    await fetchAll();
  }

  async function addDispatch(order, record) {
    const id = uid();
    const { error: insErr } = await supabase.from("expedicia_zaznamy").insert({ id, order_id: order.id, data: { ...record, id } });
    if (insErr) throw insErr;
    await fetchAll();
  }

  async function deleteDispatch(id) {
    const { error: delErr } = await supabase.from("expedicia_zaznamy").delete().eq("id", id);
    if (delErr) throw delErr;
    await fetchAll();
  }

  const finishedStock = computeFinishedGoodsStock(outputs, dispatches);
  const openOrder = orders.find((o) => o.id === openOrderId);

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-slate-500">
          <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          Zatím žádné objednávky.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Zákazník</th>
                <th className="px-3 py-2 font-medium">Město</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Číslo objednávky</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Číslo LS</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">LS zákazníka</th>
                <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Pal. místa</th>
                <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Palet</th>
                <th className="px-3 py-2 font-medium text-right">Stav</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const expedovana = o.stav_expedicie === "Expedovana";
                return (
                  <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenOrderId(o.id)}>
                    <td className="px-3 py-2">{o.zakaznik || <span className="text-slate-400">-</span>}</td>
                    <td className="px-3 py-2">{extractCityFromAddress(o.adresa_dodania) || <span className="text-slate-400">-</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{o.cislo_objednavky_dopravy}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{o.cislo_dodacieho_listu}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{o.cislo_objednavky_zakaznika || <span className="text-slate-300">-</span>}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{o.pocet_paletovych_miest || <span className="text-slate-300">-</span>}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{o.pocet_paliet || <span className="text-slate-300">-</span>}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpedovana(o); }}
                        disabled={updatingId === o.id}
                        className={
                          "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border disabled:opacity-60 " +
                          (expedovana
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
                            : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200")
                        }
                      >
                        {updatingId === o.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : expedovana ? (
                          <PackageCheck size={12} />
                        ) : (
                          <PackageX size={12} />
                        )}
                        {expedovana ? "Expedováno" : "Neexpedováno"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-300"><ChevronRight size={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openOrder && (
        <OrderDetailModal
          order={openOrder}
          products={products}
          carriers={carriers}
          dispatches={dispatches.filter((d) => d.orderId === openOrder.id)}
          finishedStock={finishedStock}
          fullName={fullName}
          onClose={() => setOpenOrderId(null)}
          onAddDispatch={(record) => addDispatch(openOrder, record)}
          onDeleteDispatch={deleteDispatch}
        />
      )}
    </div>
  );
}

function OrderDetailModal({ order, products, carriers, dispatches, finishedStock, fullName, onClose, onAddDispatch, onDeleteDispatch }) {
  const [datum, setDatum] = useState(() => todayStr());
  const [linka, setLinka] = useState("sacky");
  const [produktId, setProduktId] = useState("");
  const [paliet, setPaliet] = useState("");
  const [kartonov, setKartonov] = useState("");
  const [sarza, setSarza] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [photoPath, setPhotoPath] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoFormId, setPhotoFormId] = useState(() => uid());

  const [overallPhotoPath, setOverallPhotoPath] = useState("");
  const [overallPhotoPreview, setOverallPhotoPreview] = useState("");
  const [overallPhotoUploading, setOverallPhotoUploading] = useState(false);
  const [overallPhotoError, setOverallPhotoError] = useState("");
  const [overallPhotoFormId, setOverallPhotoFormId] = useState(() => uid());
  const [overallSaving, setOverallSaving] = useState(false);

  const [carrierId, setCarrierId] = useState("");
  const [customCarrier, setCustomCarrier] = useState(false);
  const [carrierName, setCarrierName] = useState("");
  const [vodic, setVodic] = useState("");
  const [carrierSaving, setCarrierSaving] = useState(false);
  const [carrierError, setCarrierError] = useState("");

  const [potvrdenePrekrocenie, setPotvrdenePrekrocenie] = useState(false);

  const dopravaZaznamy = dispatches.filter((d) => d.typ === "doprava");
  const linkaProducts = products.filter((p) => p.linka === linka);
  const selectedProduct = products.find((p) => p.id === produktId);
  const stockRow = selectedProduct ? finishedStock.find((r) => r.produktId === selectedProduct.id) : null;
  const batchDispatches = dispatches.filter((d) => d.typ !== "celkova" && d.typ !== "doprava");
  const overallPhotos = dispatches.filter((d) => d.typ === "celkova");
  const nalozeneSpolu = batchDispatches.reduce((sum, d) => sum + (parseFloat(d.pocetPaliet) || 0), 0);
  const planovanePaliet = parseFloat(order.pocet_paliet) || 0;
  const prekrocenaPlanovanaPaleta = wouldExceed(nalozeneSpolu, paliet, order.pocet_paliet);
  const nalozeneKartonovSpolu = batchDispatches.reduce((sum, d) => sum + (parseFloat(d.pocetKartonov) || 0), 0);
  const planovaneKartonov = parseFloat(order.pocet_kartonov) || 0;
  const prekrocenePlanovaneKartony = wouldExceed(nalozeneKartonovSpolu, kartonov, order.pocet_kartonov);
  const paletyNaEnter = parseFloat(String(paliet).replace(",", ".")) || 0;
  const kartonovNaEnter = kartonov.trim() ? (parseFloat(String(kartonov).replace(",", ".")) || 0) : 0;
  const maPrekrocenie = prekrocenaPlanovanaPaleta || prekrocenePlanovaneKartony;
  const bigBtn = "text-sm font-semibold px-3 py-2.5 rounded-lg border-2 text-center active:scale-[0.98] transition-transform";

  async function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError("");
    try {
      setPhotoPath(await uploadExpediciaPhoto(order.id, photoFormId, file));
      setPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      setPhotoError("Nahrání fotky se nezdařilo, zkuste to znovu.");
    }
    setPhotoUploading(false);
    if (e.target) e.target.value = "";
  }

  function removePhoto() {
    setPhotoPath("");
    setPhotoPreview("");
  }

  async function handleOverallPhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setOverallPhotoUploading(true);
    setOverallPhotoError("");
    try {
      setOverallPhotoPath(await uploadExpediciaPhoto(order.id, overallPhotoFormId, file));
      setOverallPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      setOverallPhotoError("Nahrání fotky se nezdařilo, zkuste to znovu.");
    }
    setOverallPhotoUploading(false);
    if (e.target) e.target.value = "";
  }

  function removeOverallPhoto() {
    setOverallPhotoPath("");
    setOverallPhotoPreview("");
  }

  async function handleSaveOverallPhoto() {
    if (!overallPhotoPath) { setOverallPhotoError("Nejprve vyfoťte celkovou nakládku."); return; }
    setOverallPhotoError("");
    setOverallSaving(true);
    try {
      await onAddDispatch({
        typ: "celkova",
        photoPath: overallPhotoPath,
        zapisal: fullName || "",
        datum: datum.trim() || todayStr(),
        cas: nowTimeStr(),
      });
      setOverallPhotoPath(""); setOverallPhotoPreview(""); setOverallPhotoFormId(uid());
    } catch (e) {
      setOverallPhotoError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setOverallSaving(false);
  }

  async function handleAdd() {
    if (!selectedProduct) { setFormError("Vyberte produkt."); return; }
    if (!paliet.trim()) { setFormError("Zadejte počet palet."); return; }
    if (maPrekrocenie && !potvrdenePrekrocenie) {
      setFormError("Potvrďte, že překročení plánu je záměr (zaškrtávací políčko níže).");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      await onAddDispatch({
        produktId: selectedProduct.id,
        produktNazov: productLabel(selectedProduct),
        sarza: sarza.trim(),
        pocetPaliet: parseFloat(String(paliet).replace(",", ".")) || 0,
        pocetKartonov: kartonov.trim() ? (parseFloat(String(kartonov).replace(",", ".")) || 0) : null,
        photoPath: photoPath || "",
        zapisal: fullName || "",
        datum: datum.trim() || todayStr(),
        cas: nowTimeStr(),
        prekroceniePotvrdene: maPrekrocenie ? true : false,
      });
      setProduktId(""); setPaliet(""); setKartonov(""); setSarza("");
      setPhotoPath(""); setPhotoPreview(""); setPhotoError(""); setPhotoFormId(uid());
      setPotvrdenePrekrocenie(false);
    } catch (e) {
      setFormError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setSaving(false);
  }

  async function handleSaveCarrier() {
    const name = customCarrier ? carrierName.trim() : ((carriers.find((c) => c.id === carrierId) || {}).nazov || "");
    if (!name) { setCarrierError("Vyberte nebo zadejte dopravce."); return; }
    setCarrierError("");
    setCarrierSaving(true);
    try {
      await onAddDispatch({
        typ: "doprava",
        dopravcaId: customCarrier ? "" : carrierId,
        dopravca: name,
        vodic: vodic.trim(),
        zapisal: fullName || "",
        datum: datum.trim() || todayStr(),
        cas: nowTimeStr(),
      });
      setCarrierId(""); setCustomCarrier(false); setCarrierName(""); setVodic("");
    } catch (e) {
      setCarrierError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setCarrierSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <div className="text-lg font-semibold">{order.zakaznik}</div>
            <div className="text-xs text-slate-500">{order.cislo_objednavky_dopravy} - LS {order.cislo_dodacieho_listu}{order.cislo_objednavky_zakaznika ? " - LS zákazníka " + order.cislo_objednavky_zakaznika : ""}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500 mb-3">
            {order.adresa_dodania_nazov}{order.adresa_dodania_nazov ? " - " : ""}{order.adresa_dodania}
          </div>

          <div className="mb-4">
            <div className="text-xs text-slate-500 mb-1">Datum nakládky (pokud se zapisuje s odstupem, změňte na původní den)</div>
            <input
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              placeholder="DD.MM.RRRR"
              className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-xs text-slate-500">Pal. místa</div>
              <div className="text-base font-semibold">{order.pocet_paletovych_miest || "-"}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-xs text-slate-500">Plánované palety</div>
              <div className="text-base font-semibold">{order.pocet_paliet || "-"}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-xs text-slate-500">Naloženo celkem</div>
              <div className={"text-base font-semibold " + (planovanePaliet && nalozeneSpolu >= planovanePaliet ? "text-emerald-600" : "")}>{nalozeneSpolu} {planovanePaliet ? "/ " + planovanePaliet : ""}</div>
            </div>
          </div>

          <div className="text-xs font-semibold text-slate-500 mb-1.5">Doprava - kdo vyzvedává</div>
          <div className="border border-slate-200 rounded-lg p-3 mb-4">
            {carriers.length === 0 ? (
              <div className="text-xs text-slate-400 mb-2">Žádní dopravci v číselníku.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                {carriers.map((c) => (
                  <button key={c.id} onClick={() => { setCustomCarrier(false); setCarrierId(c.id); }} className={bigBtn + " " + (!customCarrier && carrierId === c.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                    {c.nazov}
                  </button>
                ))}
                <button onClick={() => { setCustomCarrier(true); setCarrierId(""); }} className={bigBtn + " " + (customCarrier ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200 border-dashed")}>
                  Jiný dopravce
                </button>
              </div>
            )}
            {customCarrier && (
              <input
                autoFocus
                value={carrierName}
                onChange={(e) => setCarrierName(e.target.value)}
                placeholder="Název dopravce"
                className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            )}
            <div className="mb-2">
              <div className="text-xs text-slate-500 mb-1">Jméno řidiče (nepovinné)</div>
              <input
                value={vodic}
                onChange={(e) => setVodic(e.target.value)}
                placeholder="např. Jan Novák"
                className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            {carrierError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {carrierError}</div>}
            <button onClick={handleSaveCarrier} disabled={carrierSaving} className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-1.5">
              {carrierSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Uložit dopravce
            </button>
          </div>
          {dopravaZaznamy.length > 0 && (
            <div className="space-y-1.5 mb-4">
              {dopravaZaznamy.map((d) => (
                <div key={d.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{d.dopravca || "-"}{d.vodic ? " - řidič: " + d.vodic : ""}</div>
                    <div className="text-xs text-slate-500">{d.datum} {d.cas} - {d.zapisal}{backdatedNote(d.createdAt, d.datum)}</div>
                  </div>
                  <button onClick={() => onDeleteDispatch(d.id)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(order.polozky) && order.polozky.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-slate-500 mb-1.5">Rozložení podle produktů (z objednávky)</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-slate-500 text-left"><th className="px-2.5 py-1.5 font-medium">Popis</th><th className="px-2.5 py-1.5 font-medium">Artikl</th><th className="px-2.5 py-1.5 font-medium text-right">Palet</th><th className="px-2.5 py-1.5 font-medium text-right">Karton</th></tr></thead>
                  <tbody>
                    {order.polozky.map((it, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2.5 py-1.5">{it.popis || "-"}</td>
                        <td className="px-2.5 py-1.5 text-slate-500">{it.artikel || "-"}</td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">{it.palet || <span className="text-slate-300">-</span>}</td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">{it.karton || <span className="text-slate-300">-</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="text-xs font-semibold text-slate-500 mb-1.5">Zapsat naloženou dávku</div>
          <div className="border border-slate-200 rounded-lg p-3 mb-4">
            <div className="grid grid-cols-3 gap-2 mb-2">
              {PRODUCTION_LINKY.map((l) => (
                <button key={l.value} onClick={() => { setLinka(l.value); setProduktId(""); }} className={bigBtn + " " + (linka === l.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {l.label}
                </button>
              ))}
            </div>
            {linkaProducts.length === 0 ? (
              <div className="text-xs text-slate-400 mb-2">Žádné produkty pro tuto linku.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                {linkaProducts.map((p) => (
                  <button key={p.id} onClick={() => setProduktId(p.id)} className={bigBtn + " " + (produktId === p.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                    {productLabel(p)}
                  </button>
                ))}
              </div>
            )}
            {stockRow && (
              <div className="text-xs text-slate-500 mb-2">Na skladě hotových: <b>{stockRow.stav} palet</b></div>
            )}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-xs text-slate-500 mb-1">Počet palet</div>
                <input
                  value={paliet}
                  onChange={(e) => { setPaliet(e.target.value); setPotvrdenePrekrocenie(false); }}
                  inputMode="decimal"
                  placeholder="např. 4"
                  className={"w-full border-2 rounded-lg px-2.5 py-2 text-sm text-center focus:outline-none focus:ring-2 " + (prekrocenaPlanovanaPaleta ? "border-red-400 focus:ring-red-500" : "border-slate-200 focus:ring-teal-600")}
                />
                {prekrocenaPlanovanaPaleta && (
                  <div className="text-xs text-red-600 mt-1">Překročení plánu ({nalozeneSpolu + paletyNaEnter} / {planovanePaliet})</div>
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Počet kartonů (nepovinné)</div>
                <input
                  value={kartonov}
                  onChange={(e) => { setKartonov(e.target.value); setPotvrdenePrekrocenie(false); }}
                  inputMode="decimal"
                  placeholder="např. 20"
                  className={"w-full border-2 rounded-lg px-2.5 py-2 text-sm text-center focus:outline-none focus:ring-2 " + (prekrocenePlanovaneKartony ? "border-red-400 focus:ring-red-500" : "border-slate-200 focus:ring-teal-600")}
                />
                {prekrocenePlanovaneKartony && (
                  <div className="text-xs text-red-600 mt-1">Překročení plánu ({nalozeneKartonovSpolu + kartonovNaEnter} / {planovaneKartonov})</div>
                )}
              </div>
            </div>
            <div className="mb-2">
              <div className="text-xs text-slate-500 mb-1">Šarže</div>
              <input value={sarza} onChange={(e) => setSarza(e.target.value)} placeholder="např. 2607A" className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
            </div>
            <div className="mb-2">
              <div className="text-xs text-slate-500 mb-1">Fotka naložené dávky (nepovinné)</div>
              <PhotoControl
                photoPath={photoPath}
                photoPreview={photoPreview}
                uploading={photoUploading}
                error={photoError}
                highlight={false}
                onSelect={handlePhotoSelect}
                onRemove={removePhoto}
                onView={openExpediciaPhoto}
              />
            </div>
            {maPrekrocenie && (
              <label className="mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 text-xs text-red-700 cursor-pointer">
                <input type="checkbox" checked={potvrdenePrekrocenie} onChange={(e) => setPotvrdenePrekrocenie(e.target.checked)} className="mt-0.5" />
                Potvrzuji, že překročení plánovaného počtu je záměr (např. zákazník dodatečně přidal zboží) a chci to přesto uložit.
              </label>
            )}
            {formError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {formError}</div>}
            <button onClick={handleAdd} disabled={saving || (maPrekrocenie && !potvrdenePrekrocenie)} className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-1.5">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Přidat dávku
            </button>
          </div>

          <div className="text-xs font-semibold text-slate-500 mb-1.5">Naložené dávky</div>
          {batchDispatches.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-4">Zatím žádné zaznamenané dávky.</div>
          ) : (
            <div className="space-y-1.5 mb-4">
              {batchDispatches.map((d) => (
                <div key={d.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">
                      {d.produktNazov} <span className="text-slate-400 font-normal">- {d.pocetPaliet} palet{d.pocetKartonov ? " / " + d.pocetKartonov + " kartonů" : ""}</span>
                      {d.prekroceniePotvrdene && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">nad plán</span>}
                    </div>
                    <div className="text-xs text-slate-500">Šarže {d.sarza || "-"} - {d.datum} {d.cas} - {d.zapisal}{backdatedNote(d.createdAt, d.datum)}</div>
                  </div>
                  {d.photoPath && (
                    <button onClick={() => openExpediciaPhoto(d.photoPath)} className="text-slate-400 hover:text-teal-700 p-1"><Camera size={16} /></button>
                  )}
                  <button onClick={() => onDeleteDispatch(d.id)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs font-semibold text-slate-500 mb-1.5">Fotka celkové nakládky (když je vše naloženo)</div>
          <div className="border border-slate-200 rounded-lg p-3 mb-4">
            <PhotoControl
              photoPath={overallPhotoPath}
              photoPreview={overallPhotoPreview}
              uploading={overallPhotoUploading}
              error={overallPhotoError}
              highlight={false}
              onSelect={handleOverallPhotoSelect}
              onRemove={removeOverallPhoto}
              onView={openExpediciaPhoto}
            />
            <button onClick={handleSaveOverallPhoto} disabled={overallSaving} className="w-full mt-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-1.5">
              {overallSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Uložit fotku nakládky
            </button>
          </div>

          {overallPhotos.length > 0 && (
            <div className="space-y-1.5">
              {overallPhotos.map((d) => (
                <div key={d.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                  <button onClick={() => openExpediciaPhoto(d.photoPath)} className="flex items-center gap-2 text-sm text-slate-700 hover:text-teal-700">
                    <Camera size={16} /> Fotka nakládky - {d.datum} {d.cas} - {d.zapisal}{backdatedNote(d.createdAt, d.datum)}
                  </button>
                  <button onClick={() => onDeleteDispatch(d.id)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Prijem tovaru (velke tlacidla, pre tablet) ---------------- */

const STAV_OPTIONS = [
  { value: "V poriadku", label: "V poriadku", icon: Check, active: "bg-emerald-600 text-white border-emerald-600", idle: "bg-white text-slate-700 border-slate-200" },
  { value: "Poskodene", label: "Poskodene", icon: XCircle, active: "bg-red-600 text-white border-red-600", idle: "bg-white text-slate-700 border-slate-200" },
  { value: "Nekompletne", label: "Nekompletne", icon: TriangleAlert, active: "bg-amber-500 text-white border-amber-500", idle: "bg-white text-slate-700 border-slate-200" },
];

function emptyReceiptForm() {
  return {
    dodavatelId: "",
    dodavatel: "",
    material: "",
    mnozstvoNum: "",
    mnozstvoUnit: "ks",
    stavPrevzatia: "V poriadku",
    poznamka: "",
    cisloDokladu: "",
    photoPath: "",
    materialObjednavkaId: "",
    materialObjednavkaCislo: "",
    datumPrijatia: todayStr(),
  };
}

function PhotoControl({ photoPath, photoPreview, uploading, error, highlight, onSelect, onRemove, onView }) {
  return (
    <div className={"rounded-xl p-3 " + (highlight ? "bg-red-50 border-2 border-red-200" : "border-2 border-slate-200")}>
      {highlight && <div className="text-sm font-semibold text-red-700 mb-2">Doporučujeme přiložit fotku poškození</div>}
      {photoPreview ? (
        <div className="flex items-center gap-3">
          <img src={photoPreview} alt="Fotka" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
          <button onClick={onRemove} className="text-sm text-slate-500 flex items-center gap-1"><X size={14} /> Odstranit</button>
        </div>
      ) : photoPath ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => (onView || openGoodsReceiptPhoto)(photoPath)} className="text-sm bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg flex items-center gap-1.5"><Camera size={16} /> Zobrazit fotku</button>
          <label className="text-sm bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg cursor-pointer flex items-center gap-1.5">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} Nahradit
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onSelect} disabled={uploading} />
          </label>
          <button onClick={onRemove} className="text-sm text-slate-400 hover:text-red-600 flex items-center gap-1"><X size={14} /> Odstranit</button>
        </div>
      ) : (
        <label className={"inline-flex items-center gap-2 px-4 py-3 rounded-xl text-base font-semibold cursor-pointer " + (highlight ? "bg-red-600 text-white" : "bg-white border-2 border-slate-200 text-slate-700")}>
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
          Vyfotit
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onSelect} disabled={uploading} />
        </label>
      )}
      {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
    </div>
  );
}

function PrijemTab({ fullName }) {
  const [suppliers, setSuppliers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [materialOrders, setMaterialOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [customSupplier, setCustomSupplier] = useState(false);
  const [customMaterial, setCustomMaterial] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [f, setF] = useState(emptyReceiptForm());
  const [formId, setFormId] = useState(() => uid());
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const fetchAll = useCallback(async () => {
    const [suppliersRes, receiptsRes, materialOrdersRes] = await Promise.all([
      supabase.from("suppliers").select("*"),
      supabase.from("goods_receipts").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("material_orders").select("*"),
    ]);
    if (suppliersRes.error || receiptsRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setSuppliers((suppliersRes.data || []).map((row) => row.data));
    setReceipts((receiptsRes.data || []).map((row) => ({ ...row.data, createdAt: row.created_at })));
    if (!materialOrdersRes.error) setMaterialOrders((materialOrdersRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    const poller = setInterval(fetchAll, 10000);
    return () => {
      cancelled = true;
      clearInterval(poller);
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  function pickSupplier(s) {
    setCustomSupplier(false);
    setF((prev) => ({ ...prev, dodavatelId: s.id, dodavatel: s.nazov }));
  }
  function pickMaterialOrder(o) {
    const parts = String(o.mnozstvo || "").match(/^([\d.,]+)\s*(.*)$/);
    setCustomSupplier(!o.dodavatelId);
    setCustomMaterial(true);
    setEditingId(null);
    setFormId(uid());
    setF({
      ...emptyReceiptForm(),
      dodavatelId: o.dodavatelId || "",
      dodavatel: o.dodavatel || "",
      material: o.popisMaterialu || "",
      mnozstvoNum: parts ? parts[1] : (o.mnozstvo || ""),
      mnozstvoUnit: parts && parts[2] ? parts[2] : "ks",
      materialObjednavkaId: o.id,
      materialObjednavkaCislo: o.cisloObjednavkyDopravy || "",
    });
    setPhotoPreview("");
    setPhotoError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function unlinkMaterialOrder() {
    setF((prev) => ({ ...prev, materialObjednavkaId: "", materialObjednavkaCislo: "" }));
  }
  function pickMaterial(m) {
    setCustomMaterial(false);
    setF((prev) => ({ ...prev, material: m }));
  }
  function pickUnit(u) {
    setF((prev) => ({ ...prev, mnozstvoUnit: u }));
  }
  function pickStav(v) {
    setF((prev) => ({ ...prev, stavPrevzatia: v }));
  }

  function loadForEdit(r) {
    setEditingId(r.id);
    setFormId(r.id);
    setCustomSupplier(!r.dodavatelId);
    setCustomMaterial(!MATERIAL_QUICK_PICKS.includes(r.material));
    const parts = String(r.mnozstvo || "").match(/^([\d.,]+)\s*(.*)$/);
    setF({
      dodavatelId: r.dodavatelId || "",
      dodavatel: r.dodavatel || "",
      material: r.material || "",
      mnozstvoNum: parts ? parts[1] : (r.mnozstvo || ""),
      mnozstvoUnit: parts && parts[2] ? parts[2] : "ks",
      stavPrevzatia: r.stavPrevzatia || "V poriadku",
      poznamka: r.poznamka || "",
      cisloDokladu: r.cisloDokladu || "",
      photoPath: r.photoPath || "",
      materialObjednavkaId: r.materialObjednavkaId || "",
      materialObjednavkaCislo: r.materialObjednavkaCislo || "",
      datumPrijatia: r.datumPrijatia || todayStr(),
    });
    setPhotoPreview("");
    setPhotoError("");
    setShowDetails(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm(keepSupplier) {
    setF((prev) => ({
      ...emptyReceiptForm(),
      dodavatelId: keepSupplier ? prev.dodavatelId : "",
      dodavatel: keepSupplier ? prev.dodavatel : "",
    }));
    setCustomMaterial(false);
    setShowDetails(false);
    setEditingId(null);
    setFormId(uid());
    setPhotoPreview("");
    setPhotoError("");
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError("");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${formId}/photo.${ext}`;
      const { error: upErr } = await supabase.storage.from(GOODS_RECEIPT_PHOTOS_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      setF((prev) => ({ ...prev, photoPath: path }));
      setPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      setPhotoError("Nahrání fotky se nezdařilo, zkuste to znovu.");
    }
    setPhotoUploading(false);
    if (e.target) e.target.value = "";
  }

  function removePhoto() {
    setF((prev) => ({ ...prev, photoPath: "" }));
    setPhotoPreview("");
  }

  async function handleSave() {
    if (!fullName) {
      setError("Nahoře v \"Kdo pracuje\" vyberte, kdo zboží převzal.");
      return;
    }
    if (!f.dodavatel.trim()) {
      setError("Vyberte nebo zadejte dodavatele.");
      return;
    }
    if (!f.material.trim()) {
      setError("Vyberte nebo zadejte materiál.");
      return;
    }
    setError("");
    setSaving(true);
    const record = {
      datumPrijatia: f.datumPrijatia.trim() || todayStr(),
      casPrijatia: nowTimeStr(),
      dodavatelId: f.dodavatelId,
      dodavatel: f.dodavatel.trim(),
      material: f.material.trim(),
      mnozstvo: [f.mnozstvoNum.trim(), f.mnozstvoUnit].filter(Boolean).join(" ").trim(),
      mnozstvoCislo: parseFloat(String(f.mnozstvoNum).replace(",", ".")) || 0,
      mnozstvoJednotka: f.mnozstvoUnit,
      cisloDokladu: f.cisloDokladu.trim(),
      stavPrevzatia: f.stavPrevzatia,
      poznamka: f.poznamka.trim(),
      prevzal: fullName || "",
      materialObjednavkaId: f.materialObjednavkaId || "",
      materialObjednavkaCislo: f.materialObjednavkaCislo || "",
      photoPath: f.photoPath || "",
    };
    try {
      if (editingId) {
        const { error: upErr } = await supabase.from("goods_receipts").update({ data: { ...record, id: editingId } }).eq("id", editingId);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from("goods_receipts").insert({ id: formId, data: { ...record, id: formId } });
        if (insErr) throw insErr;
      }
      setFlash("Uloženo");
      await fetchAll();
      resetForm(true);
    } catch (e) {
      setError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setSaving(false);
  }

  async function handleDelete(id) {
    setConfirmDelete(null);
    try {
      const { error: delErr } = await supabase.from("goods_receipts").delete().eq("id", id);
      if (delErr) throw delErr;
      if (editingId === id) resetForm(false);
      await fetchAll();
    } catch (e) {
      setError("Smazání se nezdařilo, zkuste to znovu.");
    }
  }

  const bigBtn = "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform";
  const receivedOrderIds = new Set(receipts.map((r) => r.materialObjednavkaId).filter(Boolean));
  const pendingOrders = materialOrders.filter((o) => !receivedOrderIds.has(o.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {flash && (
        <div className="mb-3 bg-emerald-600 text-white text-sm font-medium px-3 py-2.5 rounded-md flex items-center gap-2">
          <CheckCircle2 size={16} /> {flash}
        </div>
      )}

      {pendingOrders.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="text-sm font-semibold text-slate-500 mb-2">Čekající objednávky surovin/obalů (kliknutím načtete do formuláře)</div>
          <div className="space-y-1.5">
            {pendingOrders.map((o) => (
              <button key={o.id} onClick={() => pickMaterialOrder(o)} className={"w-full text-left rounded-lg px-3 py-2.5 border-2 " + (f.materialObjednavkaId === o.id ? "border-teal-700 bg-teal-50" : "border-slate-200 bg-slate-50")}>
                <div className="font-medium text-sm">{o.dodavatel || "-"} <span className="text-slate-400 font-normal">- {o.cisloObjednavkyDopravy}</span></div>
                <div className="text-xs text-slate-500">{o.popisMaterialu} {o.mnozstvo ? "- " + o.mnozstvo : ""}{o.datumVyzdvihnutia ? " - " + o.datumVyzdvihnutia : ""}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="text-lg font-semibold mb-3">{editingId ? "Upravit příjem" : "Nový příjem zboží"}</div>

        {f.materialObjednavkaId && (
          <div className="mb-3 bg-teal-50 text-teal-800 text-sm px-3 py-2 rounded-lg flex items-center justify-between gap-2">
            <span>Vázáno na objednávku <b>{f.materialObjednavkaCislo}</b></span>
            <button onClick={unlinkMaterialOrder} className="text-xs text-teal-700 hover:text-teal-900 underline">Zrušit propojení</button>
          </div>
        )}

        <div className="mb-1 text-sm font-medium text-slate-500">Datum přijetí (pokud se zapisuje s odstupem, změňte na původní den)</div>
        <input
          value={f.datumPrijatia}
          onChange={(e) => setF({ ...f, datumPrijatia: e.target.value })}
          placeholder="DD.MM.RRRR"
          className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-teal-600"
        />

        <div className="mb-1 text-sm font-medium text-slate-500">Dodavatel</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
          {suppliers.map((s) => (
            <button key={s.id} onClick={() => pickSupplier(s)} className={bigBtn + " " + (!customSupplier && f.dodavatelId === s.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
              {s.nazov}
            </button>
          ))}
          <button onClick={() => { setCustomSupplier(true); setF((p) => ({ ...p, dodavatelId: "", dodavatel: "" })); }} className={bigBtn + " " + (customSupplier ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200 border-dashed")}>
            Jiný dodavatel
          </button>
        </div>
        {customSupplier && (
          <input
            autoFocus
            value={f.dodavatel}
            onChange={(e) => setF({ ...f, dodavatel: e.target.value })}
            placeholder="Název dodavatele"
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        )}

        <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Materiál</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
          {[...MATERIAL_QUICK_PICKS, ...extraKnownMaterials(receipts, [], MATERIAL_QUICK_PICKS)].map((m) => (
            <button key={m} onClick={() => pickMaterial(m)} className={bigBtn + " " + (!customMaterial && f.material === m ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
              {m}
            </button>
          ))}
          <button onClick={() => { setCustomMaterial(true); setF((p) => ({ ...p, material: "" })); }} className={bigBtn + " " + (customMaterial ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200 border-dashed")}>
            Jiný materiál
          </button>
        </div>
        {customMaterial && (
          <input
            autoFocus
            value={f.material}
            onChange={(e) => setF({ ...f, material: e.target.value })}
            placeholder="Název materiálu"
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        )}

        <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Množství</div>
        <div className="flex gap-2 mb-2">
          <input
            value={f.mnozstvoNum}
            onChange={(e) => setF({ ...f, mnozstvoNum: e.target.value })}
            inputMode="decimal"
            placeholder="např. 20"
            className="w-28 border-2 border-slate-200 rounded-xl px-3 py-3 text-base text-center focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <div className="flex gap-2 flex-wrap flex-1">
            {UNIT_QUICK_PICKS.map((u) => (
              <button key={u} onClick={() => pickUnit(u)} className={"px-3.5 py-3 rounded-xl border-2 text-base font-medium " + (f.mnozstvoUnit === u ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Stav při převzetí</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {STAV_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = f.stavPrevzatia === opt.value;
            return (
              <button key={opt.value} onClick={() => pickStav(opt.value)} className={bigBtn + " flex flex-col items-center gap-1 " + (active ? opt.active : opt.idle)}>
                <Icon size={20} />
                {opt.label}
              </button>
            );
          })}
        </div>

        {f.stavPrevzatia === "Poskodene" && (
          <div className="mb-2 mt-1">
            <PhotoControl
              photoPath={f.photoPath}
              photoPreview={photoPreview}
              uploading={photoUploading}
              error={photoError}
              highlight
              onSelect={handlePhotoSelect}
              onRemove={removePhoto}
            />
          </div>
        )}

        {!showDetails ? (
          <button onClick={() => setShowDetails(true)} className="mt-2 text-sm text-teal-700 font-medium">
            + Fotka, číslo dokladu, poznámka (nepovinné)
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            {f.stavPrevzatia !== "Poskodene" && (
              <PhotoControl
                photoPath={f.photoPath}
                photoPreview={photoPreview}
                uploading={photoUploading}
                error={photoError}
                highlight={false}
                onSelect={handlePhotoSelect}
                onRemove={removePhoto}
              />
            )}
            <input
              value={f.cisloDokladu}
              onChange={(e) => setF({ ...f, cisloDokladu: e.target.value })}
              placeholder="Číslo dodacího listu / faktury"
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <textarea
              value={f.poznamka}
              onChange={(e) => setF({ ...f, poznamka: e.target.value })}
              placeholder="Poznámka"
              rows={2}
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {editingId && (
            <button onClick={() => resetForm(true)} className="px-4 py-3.5 rounded-xl text-base font-semibold border-2 border-slate-200 text-slate-600">
              Zrušit
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-lg font-semibold px-4 py-4 rounded-xl flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
            {editingId ? "Uložit změny" : "Uložit příjem"}
          </button>
        </div>
      </div>

      <div className="text-sm font-semibold text-slate-500 mb-2">Poslední příjmy</div>
      {receipts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné záznamy.</div>
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => {
            const stavOpt = STAV_OPTIONS.find((o) => o.value === r.stavPrevzatia) || STAV_OPTIONS[0];
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <button onClick={() => loadForEdit(r)} className="flex-1 text-left">
                  <div className="font-medium">
                    {r.dodavatel} <span className="text-slate-400 font-normal">- {r.material}</span>
                    {r.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Počáteční stav</span>}
                  </div>
                  <div className="text-xs text-slate-500">{r.mnozstvo} - {r.datumPrijatia} {r.casPrijatia} - {r.prevzal}{r.materialObjednavkaCislo ? " - obj.: " + r.materialObjednavkaCislo : ""}{backdatedNote(r.createdAt, r.datumPrijatia)}</div>
                </button>
                <span className={"text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap " + (stavOpt.value === "V poriadku" ? "bg-emerald-100 text-emerald-700" : stavOpt.value === "Poskodene" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800")}>
                  {r.stavPrevzatia}
                </span>
                {r.photoPath && (
                  <button onClick={() => openGoodsReceiptPhoto(r.photoPath)} className="text-slate-400 hover:text-teal-700 p-1"><Camera size={18} /></button>
                )}
                <button onClick={() => setConfirmDelete(r)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={18} /></button>
              </div>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <p className="text-base text-slate-700 mb-4">Opravdu smazat záznam "{confirmDelete.dodavatel} - {confirmDelete.material}"?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2.5 text-base text-slate-500">Zrušit</button>
              <button onClick={() => handleDelete(confirmDelete.id)} className="bg-red-600 hover:bg-red-700 text-white text-base font-medium px-4 py-2.5 rounded-lg">Smazat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Zasoby (stav zasob + vydaj materialu) ---------------- */

function emptyIssueForm() {
  return {
    material: "",
    mnozstvoNum: "",
    mnozstvoUnit: "ks",
    dovod: "Vyroba",
    poznamka: "",
  };
}

function emptyOpeningForm() {
  return {
    material: "",
    mnozstvoNum: "",
    mnozstvoUnit: "ks",
    datum: todayStr(),
  };
}

function ZasobyTab({ fullName }) {
  const [receipts, setReceipts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [products, setProducts] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");
  const [customMaterial, setCustomMaterial] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [f, setF] = useState(emptyIssueForm());

  const [showOpening, setShowOpening] = useState(false);
  const [customOpeningMaterial, setCustomOpeningMaterial] = useState(false);
  const [openingSaving, setOpeningSaving] = useState(false);
  const [openingError, setOpeningError] = useState("");
  const [of, setOf] = useState(emptyOpeningForm());

  const [potvrdenyMinus, setPotvrdenyMinus] = useState(false);

  const [showOpeningFinished, setShowOpeningFinished] = useState(false);
  const [openingLinka, setOpeningLinka] = useState("sacky");
  const [openingProduktId, setOpeningProduktId] = useState("");
  const [openingPaliet, setOpeningPaliet] = useState("");
  const [openingFinishedDatum, setOpeningFinishedDatum] = useState(() => todayStr());
  const [openingFinishedSaving, setOpeningFinishedSaving] = useState(false);
  const [openingFinishedError, setOpeningFinishedError] = useState("");

  const fetchAll = useCallback(async () => {
    const [receiptsRes, issuesRes, productsRes, outputsRes, dispatchesRes] = await Promise.all([
      supabase.from("goods_receipts").select("*"),
      supabase.from("stock_issues").select("*").order("created_at", { ascending: false }),
      supabase.from("products").select("*"),
      supabase.from("production_outputs").select("*"),
      supabase.from("expedicia_zaznamy").select("*"),
    ]);
    if (receiptsRes.error || issuesRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setReceipts((receiptsRes.data || []).map((row) => row.data));
    setIssues((issuesRes.data || []).map((row) => row.data));
    if (!productsRes.error) setProducts((productsRes.data || []).map((row) => row.data));
    if (!outputsRes.error) setOutputs((outputsRes.data || []).map((row) => row.data));
    if (!dispatchesRes.error) setDispatches((dispatchesRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    const poller = setInterval(fetchAll, 10000);
    return () => {
      cancelled = true;
      clearInterval(poller);
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const stock = computeStockLevels(receipts, issues);
  const finishedStock = computeFinishedGoodsStock(outputs, dispatches);
  const mnozstvoNaEnter = parseFloat(String(f.mnozstvoNum).replace(",", ".")) || 0;
  const stockRow = stock.find((r) => r.material.trim().toLowerCase() === f.material.trim().toLowerCase() && r.unit.toLowerCase() === f.mnozstvoUnit.toLowerCase());
  const dostupneMnozstvo = stockRow ? stockRow.stav : 0;
  const presahujeStock = !!f.material.trim() && mnozstvoNaEnter > 0 && mnozstvoNaEnter > dostupneMnozstvo;
  const extraMaterialy = extraKnownMaterials(receipts, issues, MATERIAL_QUICK_PICKS);

  function pickOpeningMaterial(m) {
    setCustomOpeningMaterial(false);
    setOf((prev) => ({ ...prev, material: m }));
  }
  function pickOpeningUnit(u) {
    setOf((prev) => ({ ...prev, mnozstvoUnit: u }));
  }

  async function handleSaveOpening() {
    if (!of.material.trim()) { setOpeningError("Vyberte nebo zadejte materiál."); return; }
    if (!of.mnozstvoNum.trim()) { setOpeningError("Zadejte množství."); return; }
    setOpeningError("");
    setOpeningSaving(true);
    const id = uid();
    const record = {
      id,
      datumPrijatia: of.datum.trim() || todayStr(),
      casPrijatia: nowTimeStr(),
      dodavatelId: "",
      dodavatel: "Počáteční stav",
      material: of.material.trim(),
      mnozstvo: [of.mnozstvoNum.trim(), of.mnozstvoUnit].filter(Boolean).join(" ").trim(),
      mnozstvoCislo: parseFloat(String(of.mnozstvoNum).replace(",", ".")) || 0,
      mnozstvoJednotka: of.mnozstvoUnit,
      cisloDokladu: "",
      stavPrevzatia: "V poriadku",
      poznamka: "Počáteční stav zásob při zavedení evidence",
      prevzal: fullName || "",
      materialObjednavkaId: "",
      materialObjednavkaCislo: "",
      photoPath: "",
      pociatocnyStav: true,
    };
    try {
      const { error: insErr } = await supabase.from("goods_receipts").insert({ id, data: record });
      if (insErr) throw insErr;
      setFlash("Počáteční stav uložen");
      await fetchAll();
      setOf(emptyOpeningForm());
      setCustomOpeningMaterial(false);
    } catch (e) {
      setOpeningError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setOpeningSaving(false);
  }

  async function handleSaveOpeningFinished() {
    const product = products.find((p) => p.id === openingProduktId);
    if (!product) { setOpeningFinishedError("Vyberte produkt."); return; }
    if (!openingPaliet.trim()) { setOpeningFinishedError("Zadejte počet palet."); return; }
    setOpeningFinishedError("");
    setOpeningFinishedSaving(true);
    const id = uid();
    const record = {
      id,
      datum: openingFinishedDatum.trim() || todayStr(),
      cas: nowTimeStr(),
      produktId: product.id,
      produktNazov: productLabel(product),
      linka: openingLinka,
      mnozstvo: parseFloat(String(openingPaliet).replace(",", ".")) || 0,
      sarza: "",
      zapisala: fullName || "",
      issueIds: [],
      pociatocnyStav: true,
    };
    try {
      const { error: insErr } = await supabase.from("production_outputs").insert({ id, data: record });
      if (insErr) throw insErr;
      setFlash("Počáteční stav hotových výrobků uložen");
      await fetchAll();
      setOpeningProduktId("");
      setOpeningPaliet("");
    } catch (e) {
      setOpeningFinishedError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setOpeningFinishedSaving(false);
  }

  function pickMaterial(m) {
    setCustomMaterial(false);
    setF((prev) => ({ ...prev, material: m }));
    setPotvrdenyMinus(false);
  }
  function pickUnit(u) {
    setF((prev) => ({ ...prev, mnozstvoUnit: u }));
    setPotvrdenyMinus(false);
  }
  function pickDovod(d) {
    setF((prev) => ({ ...prev, dovod: d }));
  }

  async function handleSave() {
    if (!f.material.trim()) {
      setError("Vyberte nebo zadejte materiál.");
      return;
    }
    if (!f.mnozstvoNum.trim()) {
      setError("Zadejte množství.");
      return;
    }
    if (presahujeStock && !potvrdenyMinus) {
      setError("Potvrďte, že překročení stavu zásob je záměr (zaškrtávací políčko níže).");
      return;
    }
    setError("");
    setSaving(true);
    const record = {
      datum: todayStr(),
      cas: nowTimeStr(),
      material: f.material.trim(),
      mnozstvo: [f.mnozstvoNum.trim(), f.mnozstvoUnit].filter(Boolean).join(" ").trim(),
      mnozstvoCislo: parseFloat(String(f.mnozstvoNum).replace(",", ".")) || 0,
      mnozstvoJednotka: f.mnozstvoUnit,
      dovod: f.dovod,
      poznamka: f.poznamka.trim(),
      zapisal: fullName || "",
      prekroceniePotvrdene: presahujeStock ? true : false,
    };
    try {
      const id = uid();
      const { error: insErr } = await supabase.from("stock_issues").insert({ id, data: { ...record, id } });
      if (insErr) throw insErr;
      setFlash("Uloženo");
      await fetchAll();
      setF(emptyIssueForm());
      setCustomMaterial(false);
      setPotvrdenyMinus(false);
    } catch (e) {
      setError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setSaving(false);
  }

  async function handleDelete(id) {
    setConfirmDelete(null);
    try {
      const { error: delErr } = await supabase.from("stock_issues").delete().eq("id", id);
      if (delErr) throw delErr;
      await fetchAll();
    } catch (e) {
      setError("Smazání se nezdařilo, zkuste to znovu.");
    }
  }

  const bigBtn = "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {flash && (
        <div className="mb-3 bg-emerald-600 text-white text-sm font-medium px-3 py-2.5 rounded-md flex items-center gap-2">
          <CheckCircle2 size={16} /> {flash}
        </div>
      )}

      <div className="mb-5">
        {!showOpening ? (
          <button onClick={() => setShowOpening(true)} className="text-sm text-teal-700 font-medium">
            + Nastavit počáteční stav zásob
          </button>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Počáteční stav zásob</div>
              <button onClick={() => setShowOpening(false)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Jednorázově zadejte, kolik daného materiálu skutečně máte na skladě, aby další příjmy/výdeje počítaly ze správného základu.</p>

            <div className="mb-1 text-sm font-medium text-slate-500">Materiál</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
              {[...MATERIAL_QUICK_PICKS, ...extraMaterialy].map((m) => (
                <button key={m} onClick={() => pickOpeningMaterial(m)} className={bigBtn + " " + (!customOpeningMaterial && of.material === m ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {m}
                </button>
              ))}
              <button onClick={() => { setCustomOpeningMaterial(true); setOf((p) => ({ ...p, material: "" })); }} className={bigBtn + " " + (customOpeningMaterial ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200 border-dashed")}>
                Jiný materiál
              </button>
            </div>
            {customOpeningMaterial && (
              <input
                autoFocus
                value={of.material}
                onChange={(e) => setOf({ ...of, material: e.target.value })}
                placeholder="Název materiálu"
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            )}

            <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Množství</div>
            <div className="flex gap-2 mb-2">
              <input
                value={of.mnozstvoNum}
                onChange={(e) => setOf({ ...of, mnozstvoNum: e.target.value })}
                inputMode="decimal"
                placeholder="např. 500"
                className="w-28 border-2 border-slate-200 rounded-xl px-3 py-3 text-base text-center focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <div className="flex gap-2 flex-wrap flex-1">
                {UNIT_QUICK_PICKS.map((u) => (
                  <button key={u} onClick={() => pickOpeningUnit(u)} className={"px-3.5 py-3 rounded-xl border-2 text-base font-medium " + (of.mnozstvoUnit === u ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Datum</div>
            <input
              value={of.datum}
              onChange={(e) => setOf({ ...of, datum: e.target.value })}
              placeholder="DD.MM.RRRR"
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />

            {openingError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {openingError}</div>}
            <button onClick={handleSaveOpening} disabled={openingSaving} className="w-full mt-1 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-base font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-2">
              {openingSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} Uložit počáteční stav
            </button>
          </div>
        )}
      </div>

      <div className="mb-5">
        {!showOpeningFinished ? (
          <button onClick={() => setShowOpeningFinished(true)} className="text-sm text-teal-700 font-medium">
            + Nastavit počáteční stav hotových výrobků
          </button>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Počáteční stav hotových výrobků</div>
              <button onClick={() => setShowOpeningFinished(false)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Jednorázově zadejte, kolik hotových palet daného produktu už máte na skladě, aby další výroba/expedice počítala ze správného základu.</p>

            <div className="mb-1 text-sm font-medium text-slate-500">Linka</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {PRODUCTION_LINKY.map((l) => (
                <button key={l.value} onClick={() => { setOpeningLinka(l.value); setOpeningProduktId(""); }} className={bigBtn + " " + (openingLinka === l.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {l.label}
                </button>
              ))}
            </div>

            <div className="mb-1 mt-2 text-sm font-medium text-slate-500">Produkt</div>
            {products.filter((p) => p.linka === openingLinka).length === 0 ? (
              <div className="text-xs text-slate-400 mb-2">Žádné produkty pro tuto linku.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                {products.filter((p) => p.linka === openingLinka).map((p) => (
                  <button key={p.id} onClick={() => setOpeningProduktId(p.id)} className={bigBtn + " " + (openingProduktId === p.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                    {productLabel(p)}
                  </button>
                ))}
              </div>
            )}

            <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Počet palet</div>
            <input
              value={openingPaliet}
              onChange={(e) => setOpeningPaliet(e.target.value)}
              inputMode="decimal"
              placeholder="např. 12"
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base text-center mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />

            <div className="mb-1 mt-1 text-sm font-medium text-slate-500">Datum</div>
            <input
              value={openingFinishedDatum}
              onChange={(e) => setOpeningFinishedDatum(e.target.value)}
              placeholder="DD.MM.RRRR"
              className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />

            {openingFinishedError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {openingFinishedError}</div>}
            <button onClick={handleSaveOpeningFinished} disabled={openingFinishedSaving} className="w-full mt-1 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-base font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-2">
              {openingFinishedSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} Uložit počáteční stav
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="text-lg font-semibold mb-3">Zapsat výdej materiálu</div>

        <div className="mb-1 text-sm font-medium text-slate-500">Materiál</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
          {[...MATERIAL_QUICK_PICKS, ...extraMaterialy].map((m) => (
            <button key={m} onClick={() => pickMaterial(m)} className={bigBtn + " " + (!customMaterial && f.material === m ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
              {m}
            </button>
          ))}
          <button onClick={() => { setCustomMaterial(true); setF((p) => ({ ...p, material: "" })); setPotvrdenyMinus(false); }} className={bigBtn + " " + (customMaterial ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200 border-dashed")}>
            Jiný materiál
          </button>
        </div>
        {customMaterial && (
          <input
            autoFocus
            value={f.material}
            onChange={(e) => { setF({ ...f, material: e.target.value }); setPotvrdenyMinus(false); }}
            placeholder="Název materiálu"
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        )}

        <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Množství{stockRow ? " (na skladě: " + dostupneMnozstvo + " " + stockRow.unit + ")" : ""}</div>
        <div className="flex gap-2 mb-2">
          <input
            value={f.mnozstvoNum}
            onChange={(e) => { setF({ ...f, mnozstvoNum: e.target.value }); setPotvrdenyMinus(false); }}
            inputMode="decimal"
            placeholder="např. 20"
            className={"w-28 border-2 rounded-xl px-3 py-3 text-base text-center focus:outline-none focus:ring-2 " + (presahujeStock ? "border-red-400 focus:ring-red-500" : "border-slate-200 focus:ring-teal-600")}
          />
          <div className="flex gap-2 flex-wrap flex-1">
            {UNIT_QUICK_PICKS.map((u) => (
              <button key={u} onClick={() => pickUnit(u)} className={"px-3.5 py-3 rounded-xl border-2 text-base font-medium " + (f.mnozstvoUnit === u ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                {u}
              </button>
            ))}
          </div>
        </div>
        {presahujeStock && (
          <>
            <div className="text-xs text-red-600 mb-2">Překročení stavu zásob (na skladě {dostupneMnozstvo} {f.mnozstvoUnit}, zadáváte {mnozstvoNaEnter})</div>
            <label className="mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 text-xs text-red-700 cursor-pointer">
              <input type="checkbox" checked={potvrdenyMinus} onChange={(e) => setPotvrdenyMinus(e.target.checked)} className="mt-0.5" />
              Potvrzuji, že výdej nad stav zásob je záměr a chci to přesto uložit.
            </label>
          </>
        )}

        <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Důvod</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {STOCK_ISSUE_REASONS.map((d) => (
            <button key={d} onClick={() => pickDovod(d)} className={bigBtn + " " + (f.dovod === d ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
              {d}
            </button>
          ))}
        </div>

        <textarea
          value={f.poznamka}
          onChange={(e) => setF({ ...f, poznamka: e.target.value })}
          placeholder="Poznámka (nepovinné)"
          rows={2}
          className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mt-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
        />

        <button
          onClick={handleSave}
          disabled={saving || (presahujeStock && !potvrdenyMinus)}
          className="w-full mt-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-lg font-semibold px-4 py-4 rounded-xl flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
          Uložit výdej
        </button>
      </div>

      <div className="text-sm font-semibold text-slate-500 mb-2">Aktuální stav zásob</div>
      {stock.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm mb-5">Zatím žádná data.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Materiál</th>
                <th className="px-3 py-2 font-medium text-right">Přijato</th>
                <th className="px-3 py-2 font-medium text-right">Vydáno</th>
                <th className="px-3 py-2 font-medium text-right">Stav</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr key={row.material + row.unit} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.material}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{row.prijate} {row.unit}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{row.vydane} {row.unit}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.stav} {row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-sm font-semibold text-slate-500 mb-2">Hotové výrobky na skladě</div>
      {finishedStock.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm mb-5">Zatím žádná data.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium text-right">Vyrobeno</th>
                <th className="px-3 py-2 font-medium text-right">Expedováno</th>
                <th className="px-3 py-2 font-medium text-right">Stav (palet)</th>
              </tr>
            </thead>
            <tbody>
              {finishedStock.map((row) => (
                <tr key={row.produktId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.produktNazov}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{row.vyrobene}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{row.expedovane}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.stav}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-sm font-semibold text-slate-500 mb-2">Poslední výdeje</div>
      {issues.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné záznamy.</div>
      ) : (
        <div className="space-y-2">
          {issues.slice(0, 20).map((i) => (
            <div key={i.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="font-medium">
                  {i.material} <span className="text-slate-400 font-normal">- {i.mnozstvo}</span>
                  {i.prekroceniePotvrdene && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">nad stav zásob</span>}
                </div>
                <div className="text-xs text-slate-500">{i.dovod} - {i.datum} {i.cas} - {i.zapisal}</div>
              </div>
              <button onClick={() => setConfirmDelete(i)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <p className="text-base text-slate-700 mb-4">Opravdu smazat výdej "{confirmDelete.material} - {confirmDelete.mnozstvo}"?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2.5 text-base text-slate-500">Zrušit</button>
              <button onClick={() => handleDelete(confirmDelete.id)} className="bg-red-600 hover:bg-red-700 text-white text-base font-medium px-4 py-2.5 rounded-lg">Smazat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
