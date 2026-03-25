import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/axios-config"; // Import axios configuration

createRoot(document.getElementById("root")!).render(<App />);
