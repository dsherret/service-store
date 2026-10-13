import { build, emptyDir } from "@deno/dnt";

Deno.chdir(new URL("../", import.meta.url));

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {},
  test: false,
  compilerOptions: {
    stripInternal: false,
    skipLibCheck: false,
    lib: ["ESNext"],
    target: "ES2022",
  },
  scriptModule: false,
  declarationMap: false,
  skipSourceOutput: true,
  package: {
    name: "@dsherret/service-store",
    // only used for publishing, so a placeholder is fine for local builds
    version: Deno.args[0] ?? "0.0.0",
    description: "Lightweight dependency injection.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/dsherret/service-store.git",
    },
    keywords: [
      "dependency-injection",
      "di",
      "ioc",
      "service",
      "store",
    ],
    bugs: {
      url: "https://github.com/dsherret/service-store/issues",
    },
  },
  postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
