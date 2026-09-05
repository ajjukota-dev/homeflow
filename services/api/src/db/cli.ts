import { db } from "./index";
import { migrate } from "./migrate";

// `npm run migrate` — also invoked at API boot via initDb().
migrate(db)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations");
    return db.close();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
