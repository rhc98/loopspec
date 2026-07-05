#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./run.js";
import { validateCommand } from "./validate.js";
import { initCommand } from "./init.js";
import { statusCommand } from "./status.js";
import { statsCommand } from "./stats.js";
import { installCommand } from "./install.js";

const program = new Command();

program.name("loopspec").description("Convergent sweep engine").version("1.0.0");

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
  .option("-C, --repo <dir>", "target repository directory", process.cwd())
  .option("--resume <runId>", "resume an existing run-log instead of starting fresh")
  .option("--yes", "override the trust gate for DANGER-level findings")
  .action(async (charter: string, opts: { repo: string; resume?: string; yes?: boolean }) => {
    process.exit(await runCommand(charter, { repo: opts.repo, resume: opts.resume, yes: opts.yes }));
  });

program.parseAsync();
