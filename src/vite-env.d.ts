/// <reference types="vite/client" />

declare module "virtual:sandbox-libs" {
  /** lodash, YAML and Zod as one script that sets `_`, `YAML` and `z` on the window. */
  const source: string;
  export default source;
}
