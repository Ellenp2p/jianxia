import assert from "node:assert/strict";
import test from "node:test";
import { answerCommand, loginCodeOf, parseCommand } from "./commands.ts";
import { DRILL, DRILL_TALKS } from "./drill.ts";
import { DEFAULT_SETTINGS, fold } from "./logic.ts";
import { commandFromUpdate } from "./parse.ts";

const NOW = Date.UTC(2026, 8, 27, 1, 0);

test("plain Chinese and slash commands parse the same filters", () => {
  const parsed = parseCommand("历史 私聊 昨天 闪照 页2 桥");
  assert.equal(parsed?.name, "history");
  assert.equal(parsed?.query.scope, "private");
  assert.equal(parsed?.query.when, "yesterday");
  assert.equal(parsed?.query.flashOnly, true);
  assert.equal(parsed?.query.page, 2);
  assert.equal(parsed?.query.text, "桥");
  assert.equal(parseCommand("/history@bot 群 本月")?.query.scope, "group");
  assert.equal(parseCommand("谁")?.name, "people");
  assert.equal(parseCommand("我的ID")?.name, "id");
  assert.equal(parseCommand("你好"), null);
});

test("archive replies only go to the registered admin", () => {
  const state = fold(DRILL, DEFAULT_SETTINGS, DRILL_TALKS);
  const base = { people: state.people, history: state.history, now: NOW };
  assert.equal(answerCommand({ ...base, text: "历史", userId: "7", adminId: "4242" }), null);
  assert.equal(answerCommand({ ...base, text: "/history", userId: "7", adminId: "" }), null);
  assert.equal(answerCommand({ ...base, text: "帮助", userId: "7", adminId: "4242" }), null);
  const id = answerCommand({ ...base, text: "我的id", userId: "7", adminId: "4242" });
  assert.match(id ?? "", /7/);
  assert.doesNotMatch(id ?? "", /林/);
});

test("a login phrase never returns the archive", () => {
  const state = fold(DRILL, DEFAULT_SETTINGS, DRILL_TALKS);
  assert.equal(loginCodeOf("/start login_ab12cd"), "ab12cd");
  assert.equal(loginCodeOf("登录 ab12cd"), "ab12cd");
  assert.equal(loginCodeOf("历史 私聊"), null);
  assert.equal(
    answerCommand({
      text: "/start login_ab12cd",
      userId: "4242",
      adminId: "4242",
      people: state.people,
      history: state.history,
      now: NOW,
    }),
    null,
  );
});

test("Chinese private query returns yesterday flashes and ignores groups", () => {
  const state = fold(DRILL, DEFAULT_SETTINGS, DRILL_TALKS);
  const reply = answerCommand({
    text: "历史 私聊 昨天 闪照",
    userId: "4242",
    adminId: "4242",
    people: state.people,
    history: state.history,
    now: NOW,
  });
  assert.match(reply ?? "", /9001/);
  assert.match(reply ?? "", /看完就没的一张/);
  assert.doesNotMatch(reply ?? "", /河灯日报/);
  const groups = answerCommand({
    text: "人 群",
    userId: "4242",
    adminId: "4242",
    people: state.people,
    history: state.history,
    now: NOW,
  });
  assert.match(groups ?? "", /裁缝工作室/);
  assert.doesNotMatch(groups ?? "", /林编辑/);
  const heard = commandFromUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      text: "历史 私聊",
      chat: { id: 4242, type: "private", first_name: "甲" },
      from: { id: 4242, first_name: "甲" },
    },
  });
  assert.equal(heard?.userId, "4242");
  const group = commandFromUpdate({
    update_id: 2,
    message: {
      message_id: 2,
      date: 1,
      text: "历史",
      chat: { id: -100, type: "supergroup", title: "群" },
      from: { id: 4242, first_name: "甲" },
    },
  });
  assert.equal(group, null);
});
