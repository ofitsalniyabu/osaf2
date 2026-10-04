function toPostgresSql(sql) {
  let result = '';
  let parameter = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      result += character;
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      result += character;
      if (character === '*' && next === '/') {
        result += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      result += character;
      if (character === quote) {
        if (next === quote) {
          result += next;
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === '\\' && next) {
        result += next;
        index += 1;
      }
      continue;
    }
    if (character === '-' && next === '-') {
      result += character + next;
      index += 1;
      lineComment = true;
    } else if (character === '/' && next === '*') {
      result += character + next;
      index += 1;
      blockComment = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      result += character;
    } else if (character === '?') {
      parameter += 1;
      result += `$${parameter}`;
    } else {
      result += character;
    }
  }

  return result;
}

function toPostgresSchema(sql) {
  return sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMP WITHOUT TIME ZONE');
}

module.exports = { toPostgresSql, toPostgresSchema };
