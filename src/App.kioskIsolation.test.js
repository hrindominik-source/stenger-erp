import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Repo nema (a zamerne nezavadza kvoli tomuto) ziadnu React-rendering test
// infrastrukturu (jsdom/@testing-library) - vsetky existujuce testy su
// cisto logicke. Kiosk izolacia (MiniERPRoot v App.jsx) je vsak strukturalna
// vlastnost suboru samotneho (co presne kazda vetva vola/importuje), takze
// sa da spolahlivo a bez krehkeho mockovania overit priamo na zdrojovom
// texte - presne to, co tieto testy robia. Cielom je zachytit regresiu typu
// "niekto omylom pridal EnvironmentBanner/inu infra zavislost naspat do
// kiosk vetvy", nie nahradzat skutocny render test.
const APP_SOURCE = readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");

function extractFunctionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start === -1) throw new Error(`function ${functionName} not found in App.jsx`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`could not find closing brace for function ${functionName}`);
}

describe("App.jsx kiosk isolation - strukturalne overenie", () => {
  it("MiniERPRoot je jediny default export", () => {
    const defaultExports = APP_SOURCE.match(/^export default /gm) || [];
    expect(defaultExports).toHaveLength(1);
    expect(APP_SOURCE).toMatch(/^export default function MiniERPRoot\(\)/m);
  });

  it("kiosk vetva MiniERPRoot nevola MiniERP() ani useAuth - nikdy nemontuje autentifikovanu appku", () => {
    const body = extractFunctionBody(APP_SOURCE, "MiniERPRoot");
    const kioskBranch = body.slice(0, body.indexOf("return <MiniERP />;"));
    expect(kioskBranch).toContain("OnboardingKiosk");
    expect(kioskBranch).not.toContain("MiniERP()");
    expect(kioskBranch).not.toContain("<MiniERP");
    expect(kioskBranch).not.toContain("useAuth");
  });

  it("non-kiosk vetva MiniERPRoot vraci existujuci <MiniERP /> bez zmeny spravania", () => {
    const body = extractFunctionBody(APP_SOURCE, "MiniERPRoot");
    expect(body).toMatch(/return <MiniERP \/>;\s*}\s*$/);
  });

  it("EnvironmentBanner nie je nikde v App.jsx pouzity (kiosk izolacia nezavisi od vylucenej infra prace)", () => {
    expect(APP_SOURCE).not.toContain("EnvironmentBanner");
  });

  it("Docker/Caddy/VPS infra odkazy nie su v App.jsx pritomne", () => {
    expect(APP_SOURCE.toLowerCase()).not.toMatch(/caddy|docker|vps deploy/);
  });

  it("MiniERP (hlavna appka) uz nie je default export - existuje presne jeden root export (MiniERPRoot)", () => {
    expect(APP_SOURCE).toMatch(/^function MiniERP\(\) \{/m);
    expect(APP_SOURCE).not.toMatch(/^export default function MiniERP\(\) \{/m);
  });
});
