import assert from "node:assert/strict";
import test from "node:test";
import { DRILL, DRILL_TALKS } from "./drill.ts";
import { DEFAULT_SETTINGS, fold, hamming } from "./logic.ts";
import { mediaFromUpdate, observeUpdate } from "./parse.ts";

test("drill keeps listed media, drops exact and visual duplicates, skips the rest", () => {
  const state = fold(DRILL, DEFAULT_SETTINGS);
  const kept = state.items.filter((item) => item.status === "kept");
  const dups = state.items.filter((item) => item.status === "duplicate");
  assert.deepEqual(
    kept.map((item) => item.fileUniqueId).sort(),
    ["uq-city", "uq-cup", "uq-desk", "uq-flash", "uq-stall", "uq-wool"].sort(),
  );
  assert.equal(dups.length, 2);
  const fileDup = dups.find((item) => item.fileUniqueId === "uq-city");
  const city = kept.find((item) => item.fileUniqueId === "uq-city");
  assert.equal(fileDup?.duplicateReason, "file");
  assert.equal(fileDup?.duplicateOfId, city?.id);
  const visualDup = dups.find((item) => item.fileUniqueId === "uq-desk-re");
  assert.equal(visualDup?.duplicateReason, "visual");
  assert.ok(state.logs.some((log) => log.detail.includes("动图")));
  assert.ok(state.logs.some((log) => log.detail.includes("不在来源名单")));
  assert.ok(state.logs.some((log) => log.detail.includes("新的群")));
  assert.deepEqual(state.enrolledPrivate.sort(), ["9001", "9002", "9003"]);
  assert.deepEqual(state.enrolledGroup, []);
});

test("turning videos off records a skip instead of a file", () => {
  const state = fold(DRILL, { ...DEFAULT_SETTINGS, videos: false });
  assert.equal(state.items.some((item) => item.kind === "video"), false);
  assert.ok(state.logs.some((log) => log.title.includes("跳过视频")));
});

test("new private chats stay out when the switch is off", () => {
  const state = fold(DRILL, { ...DEFAULT_SETTINGS, watchNewPrivate: false });
  assert.equal(state.items.some((item) => item.chatTitle === "林编辑"), false);
  assert.equal(state.items.some((item) => item.chatTitle === "陈裁缝"), false);
  assert.equal(state.enrolledPrivate.length, 0);
});

test("hamming is zero for the same fingerprint", () => {
  assert.equal(hamming("fedcba9876543210", "fedcba9876543210"), 0);
  assert.ok(hamming("fedcba9876543210", "fedcba9876543211") > 0);
});

test("people keep a hidden id while names change, and flashes stay in the history", () => {
  const state = fold(DRILL, DEFAULT_SETTINGS, DRILL_TALKS);
  const lin = state.people.find((person) => person.hiddenId === "9001");
  assert.ok(lin);
  assert.deepEqual(
    lin?.names.map((snap) => `${snap.displayName}/${snap.username}`),
    ["林晚/lin_edits", "林编辑/lin_edits", "林编辑/lin_night"],
  );
  const flash = state.history.find((row) => row.reveal === "flash");
  assert.equal(flash?.hiddenId, "9001");
  assert.equal(flash?.status, "kept");
  assert.equal(flash?.displayName, "林编辑");
  assert.ok(state.people.some((person) => person.hiddenId === "-100100"));
});

test("flash photos are kept when ordinary photos are switched off", () => {
  const state = fold(DRILL, { ...DEFAULT_SETTINGS, photos: false }, DRILL_TALKS);
  assert.equal(
    state.items.some((item) => item.kind === "photo" && item.reveal === "open" && item.status === "kept"),
    false,
  );
  assert.ok(state.items.some((item) => item.reveal === "flash" && item.status === "kept"));
  assert.ok(state.history.some((row) => row.reveal === "flash"));
});

test("parser keeps the sender id apart from the chat, and marks view-once media", () => {
  const photo = mediaFromUpdate({
    update_id: 4,
    channel_post: {
      message_id: 8,
      date: 1_758_000_000,
      caption: "桥",
      chat: { id: -100100, type: "channel", title: "河灯日报", username: "hedeng_daily" },
      from: { id: 9001, first_name: "林", last_name: "编辑", username: "lin_edits" },
      ttl_seconds: 2147483647,
      photo: [
        { file_id: "small", file_unique_id: "us", width: 90, height: 90, file_size: 800 },
        { file_id: "mid", file_unique_id: "um", width: 320, height: 240, file_size: 12000 },
        { file_id: "big", file_unique_id: "ub", width: 1280, height: 960, file_size: 200000 },
      ],
    },
  });
  assert.equal(photo?.fileId, "big");
  assert.equal(photo?.fileUniqueId, "ub");
  assert.equal(photo?.previewFileId, "mid");
  assert.equal(photo?.chatId, "-100100");
  assert.equal(photo?.senderId, "9001");
  assert.equal(photo?.senderName, "林 编辑");
  assert.equal(photo?.senderUsername, "lin_edits");
  assert.equal(photo?.reveal, "flash");
  assert.equal(photo?.kind, "photo");

  const video = mediaFromUpdate({
    update_id: 5,
    message: {
      message_id: 2,
      date: 1_758_000_100,
      chat: { id: 42, type: "private", first_name: "林", last_name: "编辑" },
      video: {
        file_id: "vid",
        file_unique_id: "uv",
        width: 1280,
        height: 720,
        duration: 6,
        file_size: 1000,
        thumbnail: { file_id: "th", file_unique_id: "ut", width: 320, height: 180 },
      },
    },
  });
  assert.equal(video?.kind, "video");
  assert.equal(video?.chatTitle, "林 编辑");
  assert.equal(video?.previewFileId, "th");
  assert.equal(video?.senderId, "42");
  assert.equal(video?.duration, 6);
  const heard = observeUpdate({
    update_id: 1,
    message: { message_id: 1, date: 1, chat: { id: 7, type: "private", first_name: "周", username: "zhou" }, text: "hi" },
  });
  assert.equal(heard.media, null);
  assert.equal(heard.speakers[0]?.hiddenId, "7");
  assert.equal(heard.speakers[0]?.username, "zhou");
});
