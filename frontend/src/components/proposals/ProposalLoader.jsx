import React from "react";
import palm from "./ProposalDeckPalm.png";
import "./ProposalDeck.css";

export default function ProposalLoader({ label = "Loading proposal" }) {
  return (
    <div className="s7-loader" role="status" aria-live="polite" aria-label={label}>
      <span className="s7-loader__mark" aria-hidden="true">
        <i className="s7-loader__ring" />
        <span
          className="s7-loader__palm"
          style={{
            WebkitMaskImage: `url(${palm})`,
            maskImage: `url(${palm})`,
          }}
        />
      </span>
    </div>
  );
}
