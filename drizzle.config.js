/** @type {import("drizzle-kit").Config} */
export default {
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./.data/gitsheet.sqlite",
  },
};
