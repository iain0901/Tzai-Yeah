import assert from "node:assert/strict";
import test from "node:test";
import { parseCSV, prepareImport } from "./csv.ts";

const groups = [{ id: "g1", name: "暖心組" }];
const cards = [{ serial: "001", active: true, participantId: null }, { serial: "002", active: true, participantId: null }];

test("household number is imported as a positive integer", () => {
  const result = prepareImport("姓名,家別,家內編號\n同名,第一家,1", [], []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].householdNumber, 1);
});

test("household numbers reject invalid, missing household and intra-house duplicates", () => {
  const invalid = prepareImport("姓名,家別,家內編號\n甲,家,0\n乙,,1\n丙,家,1\n丁,家,1\n戊,另一家,1", [], []);
  assert.equal(invalid.errors.length, 3);
});

test("CSV supports BOM, quoted comma, doubled quotes and CRLF", () => {
  assert.deepEqual(parseCSV('\uFEFF姓名,家別\r\n"林,同學","小""家"\r\n'), [["姓名", "家別"], ["林,同學", '小"家']]);
});
test("CSV preserves newlines within quoted fields", () => {
  assert.deepEqual(parseCSV('姓名,家別\n王同學,"甲\n乙"'), [["姓名", "家別"], ["王同學", "甲\n乙"]]);
});
test("CSV rejects broken quote boundaries", () => {
  assert.throws(() => parseCSV('姓名\n"名字'), /引號/);
  assert.throws(() => parseCSV('姓名\n"名字"x'), /多餘文字/);
  assert.throws(() => parseCSV('姓名\n名"字'), /格式/);
});
test("roster preview resolves manual group and normalizes card serial", () => {
  const result = prepareImport("姓名,家別,組別,卡號\n陳同學,二家,暖心組,1", groups, cards);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [{ name: "陳同學", house: "二家", groupId: "g1", cardSerial: "001" }]);
});
test("roster preview permits blank optional fields", () => {
  const result = prepareImport("姓名,家別,組別,卡號\n林同學,,,", [], []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].groupId, null);
});
test("roster preview rejects unknown groups and duplicated cards", () => {
  const result = prepareImport("姓名,組別,卡號\n甲,不存在,001\n乙,暖心組,001", groups, cards);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /組別/);
  assert.match(result.errors[1], /重複/);
});
test("roster preview rejects already bound or disabled cards", () => {
  const result = prepareImport("姓名,卡號\n甲,001\n乙,002", [], [{ serial: "001", active: false }, { serial: "002", participantId: "person-a" }]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /停用/);
  assert.match(result.errors[1], /已配對/);
});
test("roster preview rejects header errors and mismatched column counts", () => {
  assert.match(prepareImport("名字\n甲", [], []).errors[0], /姓名/);
  assert.match(prepareImport("姓名,姓名\n甲,乙", [], []).errors[0], /重複欄位/);
  assert.match(prepareImport("姓名,家別\n甲,家,多一欄", [], []).errors[0], /欄位數/);
});
