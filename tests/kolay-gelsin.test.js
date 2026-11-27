const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const kg = require("../lib/kolay-gelsin");

const ENV = {
  KOLAY_GELSIN_MODE: "live",
  KOLAY_GELSIN_USER: "patygoteknolojiapi",
  KOLAY_GELSIN_PASSWORD: "secret",
};

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return handler(url, init || {}, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("kolayGelsinConfig: needs user+password; default base is apiintg", () => {
  assert.equal(kg.kolayGelsinConfig({}).configured, false);
  const cfg = kg.kolayGelsinConfig(ENV);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.mode, "live");
  assert.equal(cfg.baseUrl, kg.DEFAULT_BASE);
  assert.equal(cfg.user, "patygoteknolojiapi");
  assert.match(cfg.sender.address, /Mevlana/);
  assert.equal(cfg.sender.ready, false);
});

test("kolayGelsinConfig: sender ready when city+district ids set", () => {
  const cfg = kg.kolayGelsinConfig({
    ...ENV,
    KOLAY_GELSIN_SENDER_CITY_ID: "34",
    KOLAY_GELSIN_SENDER_DISTRICT_ID: "19829301",
  });
  assert.equal(cfg.sender.ready, true);
  assert.equal(cfg.sender.cityId, 34);
  assert.equal(cfg.sender.districtId, 19829301);
  assert.equal(cfg.sender.gsm, "5555070724");
});

test("resolveSenderLocation uses env ids without calling API", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error("should not fetch");
  });
  const loc = await kg.resolveSenderLocation({
    env: {
      ...ENV,
      KOLAY_GELSIN_SENDER_CITY_ID: "34",
      KOLAY_GELSIN_SENDER_DISTRICT_ID: "19829301",
    },
    fetchImpl,
  });
  assert.equal(loc.ok, true);
  assert.equal(loc.source, "env");
  assert.equal(loc.cityId, 34);
  assert.equal(loc.districtId, 19829301);
});

test("resolveSenderLocation parses GetCityDistricts for Gaziosmanpasa", async () => {
  kg.clearTokenCache();
  const fetchImpl = fakeFetch((url) => {
    if (String(url).includes("LoginAES")) {
      return {
        status: 200,
        async text() {
          return JSON.stringify({ result: { Token: "tok" }, StatusCode: 200 });
        },
      };
    }
    return {
      status: 200,
      async text() {
        return JSON.stringify({
          result: {
            CityName: "İstanbul",
            CityId: 34,
            Districts: [
              { DistrictName: "Arnavutköy", DistrictId: 14128027 },
              { DistrictName: "Gaziosmanpaşa", DistrictId: 19829301 },
            ],
          },
          StatusCode: 200,
          IsSuccessful: true,
        });
      },
    };
  });
  const loc = await kg.resolveSenderLocation({ env: ENV, fetchImpl });
  assert.equal(loc.ok, true);
  assert.equal(loc.source, "api");
  assert.equal(loc.cityId, 34);
  assert.equal(loc.districtId, 19829301);
  assert.match(loc.districtName, /Gaziosmanpa/);
});

test("login posts musteri/sifre to Token/LoginAES and caches Bearer token", async () => {
  kg.clearTokenCache();
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    async text() {
      // Live shape: result.Token (capital T); IsSuccessful may be false even with token
      return JSON.stringify({
        requestId: "x",
        result: { CustomerId: 1, Token: "tok-abc" },
        StatusCode: 200,
        IsSuccessful: false,
      });
    },
  }));
  const logged = await kg.login({ env: ENV, fetchImpl });
  assert.equal(logged.token, "tok-abc");
  assert.match(fetchImpl.calls[0].url, /\/api\/Token\/LoginAES$/);
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).musteri, "patygoteknolojiapi");
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).sifre, "secret");

  const again = await kg.getToken({ env: ENV, fetchImpl });
  assert.equal(again, "tok-abc");
  assert.equal(fetchImpl.calls.length, 1, "second getToken uses cache");
});

test("extractToken reads result.Token and rejects [object Object]", () => {
  assert.equal(
    kg.extractToken({ result: { Token: "jwt-here" }, IsSuccessful: false }),
    "jwt-here"
  );
  assert.equal(kg.extractToken({ result: { nested: true } }), "");
  assert.equal(kg.extractToken("[object Object]"), "");
});

test("pingKolayGelsin: OK on token, HATA on auth failure", async () => {
  kg.clearTokenCache();
  const ok = await kg.pingKolayGelsin({
    env: ENV,
    fetchImpl: fakeFetch(() => ({
      status: 200,
      async text() {
        return JSON.stringify({ data: { token: "x" } });
      },
    })),
  });
  assert.equal(ok.ok, true);
  assert.match(ok.message, /token/i);

  kg.clearTokenCache();
  const bad = await kg.pingKolayGelsin({
    env: ENV,
    fetchImpl: fakeFetch(() => ({
      status: 401,
      async text() {
        return JSON.stringify({ result: false, resultMessage: "Kullanıcı adı veya şifre hatalı" });
      },
    })),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /şifre|hatalı|401|Login/i);
});

test("vps_set_kolay_gelsin.py never prints the password and restarts PM2", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "vps_set_kolay_gelsin.py"), "utf8");
  assert.match(script, /getpass\.getpass\("Kolay Gelsin API şifre: "\)/);
  assert.match(script, /pm2 restart patygo --update-env/);
  assert.doesNotMatch(script, /print\(values|print\(.*PASSWORD/);
  assert.match(script, /KOLAY_GELSIN_PASSWORD/);
});
