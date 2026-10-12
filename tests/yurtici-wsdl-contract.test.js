const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { XMLParser } = require("fast-xml-parser");

const yk = require("../lib/yurtici-kargo");

// Yurtiçi's published ShippingOrderDispatcherServices WSDL (test and live differ only in soap:address).
const WSDL_PATH = path.join(__dirname, "fixtures", "yurtici-shipping-order-dispatcher.wsdl");
const ENV = { YURTICI_WS_USER: "U", YURTICI_WS_PASSWORD: "P", YURTICI_MODE: "test" };

const asList = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

function loadWsdl() {
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(fs.readFileSync(WSDL_PATH, "utf8"));
  const defs = doc.definitions;
  const types = {};
  for (const schema of asList(defs.types.schema)) {
    for (const type of asList(schema.complexType)) {
      const ext = type.complexContent && type.complexContent.extension;
      const seq = ext ? ext.sequence : type.sequence;
      types[type["@_name"]] = {
        base: ext ? String(ext["@_base"]).replace(/^\w+:/, "") : null,
        fields: asList(seq && seq.element).map((el) => ({
          name: el["@_name"],
          required: el["@_minOccurs"] !== "0",
          repeats: el["@_maxOccurs"] === "unbounded",
        })),
      };
    }
  }
  const operations = asList(defs.portType.operation).map((op) => op["@_name"]);
  const address = defs.service.port.address["@_location"];
  return { types, operations, address };
}

function fieldsOf(wsdl, typeName) {
  const type = wsdl.types[typeName];
  assert.ok(type, "WSDL type " + typeName);
  return (type.base ? fieldsOf(wsdl, type.base) : []).concat(type.fields);
}

/** Direct child tag names of the first <tag>…</tag> in xml, in document order. */
function childTags(xml, tag) {
  const start = xml.indexOf("<" + tag + ">");
  assert.ok(start >= 0, "request has <" + tag + ">");
  const re = /<(\/?)([\w:]+)[^>]*?(\/?)>/g;
  re.lastIndex = start + tag.length + 2;
  const names = [];
  let depth = 0;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) {
      if (depth === 0) break;
      depth -= 1;
    } else if (!m[3]) {
      if (depth === 0) names.push(m[2]);
      depth += 1;
    } else if (depth === 0) {
      names.push(m[2]);
    }
  }
  return names;
}

function assertFollowsSequence(sent, fields, label) {
  let last = -1;
  let lastName = null;
  for (const name of sent) {
    const index = fields.findIndex((f) => f.name === name);
    assert.ok(index >= 0, label + ": <" + name + "> is not in the WSDL");
    const repeat = index === last && fields[index].repeats && name === lastName;
    assert.ok(index > last || repeat, label + ": <" + name + "> is out of WSDL order");
    last = index;
    lastName = name;
  }
  for (const field of fields) {
    if (field.required) assert.ok(sent.includes(field.name), label + ": required <" + field.name + "> missing");
  }
}

function capture(respond) {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(String(init.body));
    return { ok: true, status: 200, text: async () => respond };
  };
  return { bodies, fetchImpl };
}

const ORDER = {
  id: "PTY-261012-A1B2C3",
  customer: {
    name: "Ayşe Yılmaz",
    email: "ayse@example.com",
    phone: "0555 111 22 33",
    shippingAddress: "Mevlana Mah. 911. Sk. No: 19, Gaziosmanpaşa / İstanbul",
    shippingCity: "İstanbul",
    shippingDistrict: "Gaziosmanpaşa",
  },
};

const EMPTY_RESULT =
  '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><r><outFlag>0</outFlag></r></S:Body></S:Envelope>';

test("Yurtiçi WSDL: every operation we call exists and the test endpoint matches its service address", () => {
  const wsdl = loadWsdl();
  for (const op of ["createShipment", "queryShipment", "cancelShipment"]) {
    assert.ok(wsdl.operations.includes(op), op + " is a WSDL operation");
  }
  assert.equal(new URL(yk.ENDPOINTS.test).host, new URL(wsdl.address).host);
  assert.equal(new URL(yk.ENDPOINTS.test).pathname, new URL(wsdl.address).pathname);
  assert.equal(new URL(yk.ENDPOINTS.live).pathname, new URL(wsdl.address).pathname);
  assert.equal(new URL(yk.ENDPOINTS.test).protocol, "https:", "credentials never travel over plain http");
});

test("Yurtiçi WSDL: createShipment request and ShippingOrderVO follow the WSDL sequence with all required fields", async () => {
  const wsdl = loadWsdl();
  const { bodies, fetchImpl } = capture(EMPTY_RESULT);
  await yk.createShipment(ORDER, { env: ENV, fetchImpl, cargoKey: ORDER.id, desi: 1 }).catch(() => {});
  assertFollowsSequence(childTags(bodies[0], "ship:createShipment"), fieldsOf(wsdl, "createShipment"), "createShipment");
  assertFollowsSequence(childTags(bodies[0], "ShippingOrderVO"), fieldsOf(wsdl, "ShippingOrderVO"), "ShippingOrderVO");
});

test("Yurtiçi WSDL: queryShipment and cancelShipment requests follow the WSDL sequence", async () => {
  const wsdl = loadWsdl();
  const query = capture(EMPTY_RESULT);
  await yk.queryShipments(["A", "B"], { env: ENV, fetchImpl: query.fetchImpl });
  assertFollowsSequence(childTags(query.bodies[0], "ship:queryShipment"), fieldsOf(wsdl, "queryShipment"), "queryShipment");

  const ping = capture(EMPTY_RESULT);
  await yk.pingYurtici({ env: ENV, fetchImpl: ping.fetchImpl });
  assertFollowsSequence(childTags(ping.bodies[0], "ship:queryShipment"), fieldsOf(wsdl, "queryShipment"), "ping");

  const cancel = capture(EMPTY_RESULT);
  await yk.cancelShipment("A", { env: ENV, fetchImpl: cancel.fetchImpl });
  assertFollowsSequence(childTags(cancel.bodies[0], "ship:cancelShipment"), fieldsOf(wsdl, "cancelShipment"), "cancelShipment");
});

test("Yurtiçi WSDL: the response fields we read exist where the parser looks for them", () => {
  const wsdl = loadWsdl();
  const names = (type) => fieldsOf(wsdl, type).map((f) => f.name);
  assert.ok(names("createShipmentResponse").includes("ShippingOrderResultVO"));
  assert.ok(names("shippingOrderResultVO").includes("outFlag"));
  assert.ok(names("shippingOrderResultVO").includes("jobId"));
  assert.ok(names("shippingOrderResultVO").includes("shippingOrderDetailVO"));
  for (const f of ["cargoKey", "errCode", "errMessage"]) assert.ok(names("shippingOrderDetailVO").includes(f), f);

  assert.ok(names("queryShipmentResponse").includes("ShippingDeliveryVO"));
  assert.ok(names("shippingDeliveryResultVO").includes("shippingDeliveryDetailVO"));
  for (const f of ["cargoKey", "errCode", "errMessage", "operationCode", "operationMessage", "operationStatus", "shippingDeliveryItemDetailVO"]) {
    assert.ok(names("shippingDeliveryDetailVO").includes(f), f);
  }
  for (const f of ["docId", "trackingUrl", "documentDelFlag", "returnStatus", "rejectStatus"]) {
    assert.ok(names("ShippingDeliveryItemDetailVO").includes(f), f);
  }

  assert.ok(names("cancelShipmentResponse").includes("ShippingOrderResultVO"));
  assert.ok(names("shippingCancelResultVO").includes("shippingCancelDetailVO"));
  for (const f of ["cargoKey", "errCode", "errMessage", "operationCode", "operationMessage"]) {
    assert.ok(names("shippingCancelDetailVO").includes(f), f);
  }
  for (const f of ["errorCode", "errText"]) assert.ok(names("YurticikargoWSException").includes(f), f);
});
