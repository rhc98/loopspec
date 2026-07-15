#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { runCommand } from "./run.js";
import { validateCommand } from "./validate.js";
import { initCommand } from "./init.js";
import { statusCommand } from "./status.js";
import { statsCommand } from "./stats.js";
import { installCommand } from "./install.js";

const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };

const program = new Command();

program.name("loopspec").description("Convergent sweep engine").version(pkg.version);

program
  .command("validate")
  .description("Validate a charter file (fail-closed)")
  .argument("<charter>", "path to charter YAML")
  .action((charter: string) => {
    process.exit(validateCommand(charter));
  });

program
  .command("init")
  .description("Scaffold a starter charter YAML")
  .argument("<name>", "charter name (also the output filename)")
  .option("-f, --force", "overwrite if the file already exists")
  .action((name: string, opts: { force?: boolean }) => {
    process.exit(initCommand(name, opts));
  });

program
  .command("status")
  .description("Show the latest run-log status")
  .argument("[name]", "limit to charters with this name")
  .action((name: string | undefined) => {
    process.exit(statusCommand(name));
  });

program
  .command("stats")
  .description("Aggregate cross-run convergence telemetry from run-logs")
  .argument("[name]", "limit to charters with this name")
  .action((name: string | undefined) => {
    process.exit(statsCommand(name));
  });

program
  .command("install")
  .description("Install a charter after a trust scan + explicit consent")
  .argument("<source>", "charter file path or registry ref")
  .option("--registry <dir>", "registry directory to resolve a ref against")
  .option("--yes", "consent to DANGER-level findings")
  .option("--force", "overwrite an existing destination file")
  .option("--report-only", "scan and print only; write nothing")
  .option("--dest <dir>", "destination directory for the installed charter")
  .action((source: string, opts: { registry?: string; yes?: boolean; force?: boolean; reportOnly?: boolean; dest?: string }) => {
    process.exit(installCommand(source, opts));
  });

program
  .command("run")
  .description("Run the convergent sweep over a charter")
  .argument("<charter>", "path to charter YAML")
  .argument("[tokenBump]", "extra token budget for this invocation, e.g. +50k")
  .option("-C, --repo <dir>", "target repository directory", process.cwd())
  .option("--resume <runId>", "resume an existing run-log instead of starting fresh")
  .option("--yes", "override the trust gate for DANGER-level findings")
  .option("--max-iter <n>", "override budget.max_iterations for this invocation", (v: string) => parseInt(v, 10))
  .option("--report-only", "print what would run; execute nothing, write nothing")
  .option("--filter <ids>", "comma-separated item ids to run (exact match)")
  .option("--agent <name>", "adapter that drives steps", "claude-code")
  .action(
    async (
      charter: string,
      tokenBump: string | undefined,
      opts: { repo: string; resume?: string; yes?: boolean; maxIter?: number; reportOnly?: boolean; filter?: string; agent?: string },
    ) => {
      process.exit(await runCommand(charter, { ...opts, tokenBump }));
    },
  );

program.parseAsync();
