const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPhoneSchema } = require('./phoneSchema');

test('migration relaxes email nullability without modifying existing values', async () => {
  const queries = [];
  const connection = { async execute(sql) {
    queries.push(sql);
    if (sql.startsWith('SHOW COLUMNS')) return [[{ Null: 'NO', Type: 'varchar(100)' }]];
    if (sql.startsWith('SHOW INDEX')) return [[]];
    return [[]];
  } };
  const columns = [];
  await applyPhoneSchema(connection, async (_connection, _table, column) => columns.push(column));
  assert.ok(queries.includes('ALTER TABLE users MODIFY COLUMN email varchar(100) NULL DEFAULT NULL'));
  assert.ok(queries.includes('ALTER TABLE users ADD UNIQUE INDEX uk_phone (phone)'));
  assert.deepEqual(columns, ['phone', 'phone_bound_at']);
  assert.ok(queries.every(sql => !/^(UPDATE|DELETE|DROP|TRUNCATE)/i.test(sql)));
});
test('existing nullable email and phone index are left intact on repeated migration', async () => {
  const queries = [];
  const connection = { async execute(sql) {
    queries.push(sql);
    if (sql.startsWith('SHOW COLUMNS')) return [[{ Null: 'YES', Type: 'varchar(100)' }]];
    if (sql.startsWith('SHOW INDEX')) return [[{ Key_name: 'uk_phone' }]];
    return [[]];
  } };
  await applyPhoneSchema(connection, async () => {});
  assert.ok(queries.every(sql => !sql.startsWith('ALTER TABLE')));
});
