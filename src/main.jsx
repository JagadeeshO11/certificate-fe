import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import PinAuth from "./PinAuth";
import "./styles.css";

function Root() {
  const [unlocked, setUnlocked] = useState(false);
  return unlocked ? <App /> : <PinAuth onUnlock={() => setUnlocked(true)} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
