import { promises as fs } from 'node:fs';

export class LuaParseError extends Error {}

export const LUA_NIL = Symbol('lua_nil');

export class LuaTable {
  constructor(entries) {
    this.entries = entries;
  }
}

class Token {
  constructor(kind, value, pos) {
    this.kind = kind;
    this.value = value;
    this.pos = pos;
  }
}

class Lexer {
  constructor(text) {
    this.text = text;
    this.i = 0;
    this.n = text.length;
  }

  tokens() {
    const out = [];
    while (true) {
      this.skipWsAndComments();
      if (this.i >= this.n) {
        out.push(new Token('eof', null, this.i));
        return out;
      }
      const ch = this.text[this.i];
      if (ch === '[' && this.startsLongString()) {
        out.push(new Token('string', this.readLongString(), this.i));
      } else if ('{}[]=,.;()'.includes(ch)) {
        out.push(new Token(ch, ch, this.i));
        this.i += 1;
      } else if (ch === '\'' || ch === '"') {
        out.push(new Token('string', this.readString(), this.i));
      } else if (isDigit(ch) || (ch === '-' && this.i + 1 < this.n && isDigit(this.text[this.i + 1]))) {
        out.push(new Token('number', this.readNumber(), this.i));
      } else if (isIdentStart(ch)) {
        const start = this.i;
        this.i += 1;
        while (this.i < this.n && isIdentPart(this.text[this.i])) {
          this.i += 1;
        }
        const ident = this.text.slice(start, this.i);
        if (ident === 'function') {
          out.push(new Token('string', this.readFunctionLiteral(), start));
        } else {
          out.push(new Token('ident', ident, start));
        }
      } else {
        throw new LuaParseError(`无法识别字符 ${JSON.stringify(ch)} at ${this.i}`);
      }
    }
  }

  skipWsAndComments() {
    while (this.i < this.n) {
      if (/\s/.test(this.text[this.i])) {
        this.i += 1;
        continue;
      }
      if (this.text.startsWith('--[[', this.i)) {
        const end = this.text.indexOf(']]', this.i + 4);
        this.i = end === -1 ? this.n : end + 2;
        continue;
      }
      if (this.text.startsWith('--', this.i)) {
        const end = this.text.indexOf('\n', this.i + 2);
        this.i = end === -1 ? this.n : end + 1;
        continue;
      }
      return;
    }
  }

  startsLongString() {
    return this.text.startsWith('[[', this.i);
  }

  readLongString() {
    const start = this.i + 2;
    const end = this.text.indexOf(']]', start);
    if (end === -1) {
      throw new LuaParseError('长字符串未闭合');
    }
    this.i = end + 2;
    return this.text.slice(start, end);
  }

  readString() {
    const quote = this.text[this.i];
    this.i += 1;
    const chars = [];
    while (this.i < this.n) {
      const ch = this.text[this.i];
      this.i += 1;
      if (ch === quote) {
        return chars.join('');
      }
      if (ch === '\\') {
        if (this.i >= this.n) {
          throw new LuaParseError('字符串转义未闭合');
        }
        const esc = this.text[this.i];
        this.i += 1;
        chars.push(({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', '\'': '\'' })[esc] ?? esc);
      } else {
        chars.push(ch);
      }
    }
    throw new LuaParseError('字符串未闭合');
  }

  readFunctionLiteral() {
    this.skipWsAndComments();
    if (this.i < this.n && this.text[this.i] === '(') {
      let depth = 1;
      this.i += 1;
      while (this.i < this.n && depth > 0) {
        if (this.text[this.i] === '(') depth += 1;
        else if (this.text[this.i] === ')') depth -= 1;
        this.i += 1;
      }
    }
    this.skipWsAndComments();
    const start = this.i;
    let depth = 1;
    while (this.i < this.n) {
      if (this.text[this.i] === '\'' || this.text[this.i] === '"') {
        this.skipString(this.i);
        continue;
      }
      if (this.text.startsWith('[[', this.i)) {
        this.readLongString();
        continue;
      }
      if (this.text.startsWith('--[[', this.i)) {
        const end = this.text.indexOf(']]', this.i + 4);
        this.i = end === -1 ? this.n : end + 2;
        continue;
      }
      if (this.text.startsWith('--', this.i)) {
        const end = this.text.indexOf('\n', this.i + 2);
        this.i = end === -1 ? this.n : end + 1;
        continue;
      }
      if (wordAt(this.text, this.i, 'function')) {
        this.i += 'function'.length;
        depth += 1;
        continue;
      }
      if (wordAt(this.text, this.i, 'end')) {
        const bodyEnd = this.i;
        this.i += 'end'.length;
        depth -= 1;
        if (depth === 0) {
          const lines = this.text
            .slice(start, bodyEnd)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          return `-- lua function:\n${lines.join('\n')}`;
        }
        continue;
      }
      this.i += 1;
    }
    throw new LuaParseError('函数未闭合');
  }

  skipString(start) {
    this.i = skipString(this.text, start);
  }

  readNumber() {
    const start = this.i;
    if (this.text[this.i] === '-') this.i += 1;
    while (this.i < this.n && isDigit(this.text[this.i])) this.i += 1;
    if (this.i < this.n && this.text[this.i] === '.') {
      this.i += 1;
      while (this.i < this.n && isDigit(this.text[this.i])) this.i += 1;
    }
    if (this.i < this.n && (this.text[this.i] === 'e' || this.text[this.i] === 'E')) {
      this.i += 1;
      if (this.i < this.n && (this.text[this.i] === '+' || this.text[this.i] === '-')) this.i += 1;
      while (this.i < this.n && isDigit(this.text[this.i])) this.i += 1;
    }
    const raw = this.text.slice(start, this.i);
    return raw.includes('.') || raw.includes('e') || raw.includes('E') ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  }
}

class Parser {
  constructor(text) {
    this.tokens = new Lexer(text).tokens();
    this.i = 0;
  }

  parseValue() {
    const tok = this.peek();
    if (tok.kind === '{') return this.parseTable();
    if (tok.kind === 'string') {
      this.i += 1;
      return tok.value;
    }
    if (tok.kind === 'number') {
      this.i += 1;
      return tok.value;
    }
    if (tok.kind === 'ident') {
      this.i += 1;
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'nil') return LUA_NIL;
      if (/^[a-z_]\w*$/.test(tok.value) && this.peek().kind !== '.' && this.peek().kind !== '(') return LUA_NIL;
      return this.parseIdentifierValue(tok.value);
    }
    throw new LuaParseError(`期望值，实际 ${tok.kind} at ${tok.pos}`);
  }

  parsePath() {
    const parts = [this.expect('ident').value];
    while (this.peek().kind === '.' || this.peek().kind === '[') {
      if (this.match('.')) {
        parts.push(this.expect('ident').value);
      } else {
        this.expect('[');
        parts.push(this.parseValue());
        this.expect(']');
      }
    }
    return parts;
  }

  parseIdentifierValue(first) {
    const parts = [first];
    while (this.match('.')) {
      parts.push(this.expect('ident').value);
    }
    const name = parts.join('.');
    const knownValue = knownIdentifierValue(name);
    if (knownValue !== undefined) return knownValue;
    if (this.peek().kind === '(' && isVectorConstructor(name)) {
      return this.parseCallArguments();
    }
    if (this.match('(')) {
      let depth = 1;
      while (depth > 0) {
        const tok = this.peek();
        if (tok.kind === 'eof') throw new LuaParseError('函数调用未闭合');
        this.i += 1;
        if (tok.kind === '(') depth += 1;
        else if (tok.kind === ')') depth -= 1;
      }
    }
    return name;
  }

  parseCallArguments() {
    const args = [];
    this.expect('(');
    while (!this.match(')')) {
      if (this.peek().kind === 'eof') throw new LuaParseError('函数调用未闭合');
      args.push(this.parseValue());
      if (this.peek().kind === ',') this.i += 1;
    }
    return args;
  }

  parseTable() {
    const entries = [];
    this.expect('{');
    while (!this.match('}')) {
      if (this.peek().kind === 'eof') throw new LuaParseError('table 未闭合');
      let key = null;
      let value;
      if (this.peek().kind === '[') {
        this.expect('[');
        key = this.parseValue();
        this.expect(']');
        this.expect('=');
        value = this.parseValue();
      } else if (this.peek().kind === 'ident' && this.peek(1).kind === '=') {
        key = this.expect('ident').value;
        this.expect('=');
        value = this.parseValue();
      } else {
        value = this.parseValue();
      }
      entries.push([key, value]);
      if (this.peek().kind === ',' || this.peek().kind === ';') this.i += 1;
    }
    return new LuaTable(entries);
  }

  peek(offset = 0) {
    return this.tokens[this.i + offset];
  }

  match(kind) {
    if (this.peek().kind === kind) {
      this.i += 1;
      return true;
    }
    return false;
  }

  expect(kind) {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new LuaParseError(`期望 ${kind}，实际 ${tok.kind} at ${tok.pos}`);
    }
    this.i += 1;
    return tok;
  }
}

export async function extractReturnTable(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const match = /\breturn\s*{/m.exec(text);
  if (match) {
    const value = parseTableAt(text, match.index + match[0].lastIndexOf('{'));
    if (value instanceof LuaTable) return value;
  }
  const slotMatch = /\b([A-Za-z_]\w*)\s*=\s*{/m.exec(text);
  const returnMatch = /\breturn\s+([A-Za-z_]\w*)\b/m.exec(text);
  if (slotMatch && returnMatch && slotMatch[1] === returnMatch[1]) {
    const value = parseTableAt(text, slotMatch.index + slotMatch[0].lastIndexOf('{'));
    if (value instanceof LuaTable) return value;
  }
  throw new LuaParseError(`return 不是 table: ${filePath}`);
}

export async function iterAssignments(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return iterAssignmentsFromText(text);
}

export function iterAssignmentsFromText(text) {
  const assignments = [];
  const aliases = new Set([...text.matchAll(/\b([A-Za-z_]\w*)\s*=\s*pg\b/g)].map((match) => match[1]));
  const roots = ['(?:_G\\.)?pg', ...[...aliases].sort().map(escapeRegExp)];
  const pattern = new RegExp(`((?:${roots.join('|')})(?:\\.base)?\\.[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*|\\[[^\\]]+\\])*)\\s*=\\s*(?:setmetatable\\s*\\(\\s*)?{`, 'gm');
  for (const match of text.matchAll(pattern)) {
    try {
      const lhs = parseLhs(match[1]);
      if (lhs.length > 0 && aliases.has(lhs[0])) lhs[0] = 'pg';
      const brace = text.indexOf('{', match.index);
      const rhs = parseTableAt(text, brace);
      assignments.push([lhs, rhs]);
    } catch {
    }
  }
  return assignments;
}

export async function iterRootTableAssignments(filePath, root) {
  const text = await fs.readFile(filePath, 'utf8');
  const assignments = [];
  const pattern = new RegExp(`(${escapeRegExp(root)}(?:\\[[^\\]]+\\])*)\\s*=\\s*{`, 'gm');
  for (const match of text.matchAll(pattern)) {
    try {
      const lhs = parseLhs(match[1]);
      const rhs = parseTableAt(text, match.index + match[0].lastIndexOf('{'));
      assignments.push([lhs, rhs]);
    } catch {
    }
  }
  return assignments;
}

function parseTableAt(text, start) {
  const end = findMatchingBrace(text, start);
  const value = new Parser(text.slice(start, end + 1)).parseValue();
  if (!(value instanceof LuaTable)) throw new LuaParseError('不是 table');
  return value;
}

function findMatchingBrace(text, start) {
  if (start >= text.length || text[start] !== '{') throw new LuaParseError('table 起始位置不是 {');
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\'' || ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (text.startsWith('[[', i)) {
      const end = text.indexOf(']]', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('--[[', i)) {
      const end = text.indexOf(']]', i + 4);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('--', i)) {
      const end = text.indexOf('\n', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (wordAt(text, i, 'function')) {
      i = skipFunction(text, i + 'function'.length);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new LuaParseError('table 未闭合');
}

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  throw new LuaParseError('字符串未闭合');
}

function skipFunction(text, start) {
  let i = start;
  let depth = 1;
  while (i < text.length) {
    if (text[i] === '\'' || text[i] === '"') {
      i = skipString(text, i);
      continue;
    }
    if (text.startsWith('[[', i)) {
      const end = text.indexOf(']]', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('--[[', i)) {
      const end = text.indexOf(']]', i + 4);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('--', i)) {
      const end = text.indexOf('\n', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (wordAt(text, i, 'function')) {
      depth += 1;
      i += 'function'.length;
      continue;
    }
    if (wordAt(text, i, 'end')) {
      depth -= 1;
      i += 'end'.length;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  throw new LuaParseError('函数未闭合');
}

function parseLhs(text) {
  return new Parser(text).parsePath();
}

function isVectorConstructor(name) {
  return name === 'Vector2' || name === 'Vector3' || name === 'Vector4' || name === 'Quaternion';
}

function knownIdentifierValue(name) {
  if (name === 'ShipType.MainShipType') return [4, 5];
  return undefined;
}

function wordAt(text, i, word) {
  if (!text.startsWith(word, i)) return false;
  const before = i === 0 || !isIdentPart(text[i - 1]);
  const j = i + word.length;
  const after = j >= text.length || !isIdentPart(text[j]);
  return before && after;
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
