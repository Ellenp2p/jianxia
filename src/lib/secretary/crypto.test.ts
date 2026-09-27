import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import { openSeal, seal } from "./crypto.server.ts";
import { adminIdFromSession, signAdminSession, widgetHashOk } from "./telegram-auth.ts";
import { DEFAULT_SETTINGS } from "./logic.ts";
import { present, type SecretBody } from "./snapshot.ts";

test("the vault round-trips and the browser copy has no token", () => {
  const body: SecretBody = {
    settings: { ...DEFAULT_SETTINGS, token: "123456:abcdefghijklmnopqrstuv", adminId: "4242" },
    items: [],
    logs: [],
    enrolledPrivate: [],
    enrolledGroup: [],
    people: [],
    history: [],
    updateOffset: 0,
    botName: "",
    botUsername: "",
    webhookSecret: "secret-value-not-for-the-browser",
    serverListening: false,
    lastUpdateId: 0,
    loginChallenge: null,
    loginGrant: null,
  };
  const opened = JSON.parse(openSeal(seal(JSON.stringify(body)))) as SecretBody;
  assert.equal(opened.settings.token, body.settings.token);
  const shown = present(body, 3);
  assert.equal(shown.settings.token, "");
  assert.equal(shown.tokenOnFile, true);
  assert.equal(shown.revision, 3);
  assert.equal(JSON.stringify(shown).includes("abcdefghijklmnopqrstuv"), false);
  assert.equal(JSON.stringify(shown).includes("secret-value"), false);
});

test("telegram login accepts the real hash and only that account's session", () => {
  const token = "123456:abcdefghijklmnopqrstuv";
  const fields = { auth_date: "10", first_name: "甲", id: "4242" };
  const secret = createHash("sha256").update(token).digest();
  const hash = createHmac("sha256", secret).update("auth_date=10\nfirst_name=甲\nid=4242").digest("hex");
  assert.equal(widgetHashOk(token, fields, hash), true);
  assert.equal(widgetHashOk(token, fields, "00"), false);
  const session = signAdminSession("4242", 1_000);
  assert.equal(adminIdFromSession(session, 1_000), "4242");
  assert.equal(adminIdFromSession(session, 1_000 + 13 * 60 * 60 * 1000), null);
});
