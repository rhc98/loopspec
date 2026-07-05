// fail-closed charter 검증. 에러 없으면 [] 반환, 하나라도 있으면 caller가 exit(1).

export type ValidationError = { rule: string; message: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateCharter(raw: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isObject(raw)) {
    return [{ rule: "shape", message: "charter must be a YAML mapping" }];
  }

  // rule 1: loopspec_version 존재
  if (!isNonEmptyString(raw["loopspec_version"])) {
    errors.push({ rule: "loopspec_version", message: "loopspec_version is required (non-empty string)" });
  }

  // rule 2: budget.max_budget_usd 또는 max_iterations 중 하나 필수
  const budget = raw["budget"];
  if (!isObject(budget)) {
    errors.push({ rule: "budget", message: "budget mapping is required" });
  } else if (typeof budget["max_budget_usd"] !== "number" && typeof budget["max_iterations"] !== "number") {
    errors.push({ rule: "budget", message: "budget requires at least one of max_budget_usd or max_iterations (number)" });
  }

  // rule 3: readiness=L2 이면 verify.commands 비면 안 됨
  if (raw["readiness"] === "L2") {
    const verify = raw["verify"];
    const commands = isObject(verify) ? verify["commands"] : undefined;
    if (!isStringArray(commands) || commands.length === 0) {
      errors.push({ rule: "verify", message: "readiness L2 requires a non-empty verify.commands array" });
    }
  }

  // rule 4: items 배열 각각 id/description/scope.include 필수
  const items = raw["items"];
  if (!Array.isArray(items) || items.length === 0) {
    errors.push({ rule: "items", message: "items must be a non-empty array" });
  } else {
    items.forEach((item, i) => {
      if (!isObject(item)) {
        errors.push({ rule: "items", message: `items[${i}] must be a mapping` });
        return;
      }
      if (!isNonEmptyString(item["id"])) {
        errors.push({ rule: "items", message: `items[${i}].id is required` });
      }
      if (!isNonEmptyString(item["description"])) {
        errors.push({ rule: "items", message: `items[${i}].description is required` });
      }
      const scope = item["scope"];
      const include = isObject(scope) ? scope["include"] : undefined;
      if (!isStringArray(include) || include.length === 0) {
        errors.push({ rule: "items", message: `items[${i}].scope.include must be a non-empty string array` });
      }
    });
  }

  return errors;
}
