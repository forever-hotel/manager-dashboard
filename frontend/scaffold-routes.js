import fs from "fs";
import path from "path";

const dirs = [
  "overview",
  "analytics",
  "rooms",
  "promotions",
  "staff",
  "complaints",
];

for (const dir of dirs) {
  const dirPath = path.join(
    "c:/Users/madus/OneDrive - University of Kelaniya/BSC(Hons)software engineering/4 - 1sem/design_project/code/frontend/app",
    dir,
  );
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    const content = `export default function Page() {
  return (
    <div>
      <h1>${dir.charAt(0).toUpperCase() + dir.slice(1)}</h1>
      <p>This is a placeholder for the ${dir} page.</p>
    </div>
  );
}
`;
    fs.writeFileSync(path.join(dirPath, "page.tsx"), content);
  }
}
console.log("Placeholders created");
