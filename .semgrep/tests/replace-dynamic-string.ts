declare const router: { replace(url: string, options?: { scroll?: boolean }): void };
declare function escape(value: string): string;

export function withVariableString(template: string, value: string) {
  // ruleid: luke-replace-dynamic-string
  return template.replace(/\{\{name\}\}/g, value);
}

export function withCallResult(template: string, value: string) {
  // ruleid: luke-replace-dynamic-string
  return template.replaceAll('${username}', escape(value));
}

export function withFunction(template: string, value: string) {
  // ok: luke-replace-dynamic-string
  return template.replaceAll('${username}', () => escape(value));
}

export function withLiteral(text: string) {
  // ok: luke-replace-dynamic-string
  return text.replace(/\\/g, '\\5c');
}

export function withTemplateLiteral(text: string, suffix: string) {
  // ruleid: luke-replace-dynamic-string
  return text.replace(/x$/, `-${suffix}`);
}

export function navigate(query: string) {
  // ok: luke-replace-dynamic-string
  router.replace(`?${query}`, { scroll: false });
}
