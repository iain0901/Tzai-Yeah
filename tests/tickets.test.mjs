import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTickets } from '../components/admin/tickets.mjs';
const person = { name: '王小明', house: '一家', householdNumber: 1, url: '/t/' + 'a'.repeat(48), linkActive: true };
test('formats real participant ticket and preserves exact link', () => {
 const result = prepareTickets([person], 'https://example.test');
 assert.equal(result[0].number, '10101');
 assert.equal(result[0].url, 'https://example.test/t/' + 'a'.repeat(48));
});
test('rejects the entire batch when link is absent or inactive', () => {
 for (const bad of [{...person,householdNumber:2,url:null}, {...person,householdNumber:2,linkActive:false}]) assert.throws(() => prepareTickets([person,bad], 'https://example.test'), /連結/);
});
test('rejects unrepresentable or duplicate ticket numbers and untrusted links', () => {
 for (const bad of [{...person,house:'其他'}, {...person,householdNumber:100}, {...person,url:'https://evil.test/t/'+'a'.repeat(48)}]) assert.throws(() => prepareTickets([bad], 'https://example.test'));
 assert.throws(() => prepareTickets([person,person], 'https://example.test'), /重複/);
});
