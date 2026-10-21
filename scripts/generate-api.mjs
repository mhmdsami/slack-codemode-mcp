#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'node_modules/@slack/web-api/dist');
const methodFile = path.join(dist, 'methods.d.ts');
const typeDir = path.join(dist, 'types');
const program = ts.createProgram([methodFile], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const declarations = new Map();

function collectTypeDeclarations(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeDeclarations(full);
      continue;
    }
    if (!entry.name.endsWith('.d.ts')) continue;
    const source = fs.readFileSync(full, 'utf8');
    const sf = ts.createSourceFile(full, source, ts.ScriptTarget.ES2022, true);
    for (const statement of sf.statements) {
      const name = statement.name?.text;
      if (!name) continue;
      if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      ) {
        declarations.set(name, source.slice(statement.getFullStart(), statement.getEnd()).trim());
      }
    }
  }
}
collectTypeDeclarations(typeDir);
const sourceFile = program.getSourceFile(methodFile);
let methodsClass;
ts.forEachChild(sourceFile, (node) => {
  if (ts.isClassDeclaration(node) && node.name?.text === 'Methods') methodsClass = node;
});
if (!methodsClass) throw new Error('Methods class not found in methods.d.ts');
const classType = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(methodsClass.name));
const entries = [];

function typeText(type) {
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
}

function walk(type, prefix) {
  for (const property of type.getProperties()) {
    const name = property.getName();
    const full = prefix ? `${prefix}.${name}` : name;
    const decl = property.valueDeclaration ?? property.declarations?.[0];
    const propertyType = checker.getTypeOfSymbolAtLocation(property, decl ?? methodsClass);
    const signatures = propertyType.getCallSignatures();
    if (signatures.length === 0) {
      walk(propertyType, full);
      continue;
    }
    const signature = signatures[0];
    const parameter = signature.parameters[0];
    const parameterDecl = parameter?.valueDeclaration;
    const argsType = parameter
      ? checker.getTypeOfSymbolAtLocation(parameter, parameterDecl ?? methodsClass)
      : undefined;
    const returnType = signature.getReturnType();
    const responseType = typeText(returnType)
      .replace(/^Promise</, '')
      .replace(/>$/, '');
    const trivia = decl ? sourceFile.text.slice(decl.getFullStart(), decl.getStart()) : '';
    const description = (trivia.match(/@description\s+([^\n*]+)/)?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const see = trivia.match(/@see\s+\{@link\s+([^\s]+)/)?.[1];
    const argsName = (() => {
      if (!argsType) return undefined;
      const symbol = argsType.getSymbol() ?? argsType.aliasSymbol;
      const candidate = symbol?.getName();
      if (candidate && candidate !== '__type' && candidate !== '__type') return candidate;
      return typeText(argsType);
    })();
    entries.push({
      method: full,
      required: signature.minArgumentCount > 0,
      args: argsName,
      response: responseType,
      description,
      see,
    });
  }
}
walk(classType, '');
const payload = {
  generatedAt: new Date().toISOString(),
  sdk: JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules/@slack/web-api/package.json'), 'utf8'),
  ).version,
  methods: entries.sort((a, b) => a.method.localeCompare(b.method)),
  declarations: Object.fromEntries([...declarations].sort(([a], [b]) => a.localeCompare(b))),
};
fs.writeFileSync(path.join(root, 'api-index.json'), JSON.stringify(payload));
console.log(
  `wrote api-index.json: ${payload.methods.length} methods, ${Object.keys(payload.declarations).length} type declarations, ${(fs.statSync(path.join(root, 'api-index.json')).size / 1024).toFixed(0)} KB`,
);
