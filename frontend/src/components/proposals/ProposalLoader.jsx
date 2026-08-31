import React from "react";
import palm from "./ProposalDeckPalm.png";
import "./ProposalDeck.css";

const PALM_MASK = {
  WebkitMaskImage: `url(${palm})`,
  maskImage: `url(${palm})`,
};

export default function ProposalLoader({
  label = "Loading proposal",
  motion = "lift",
  framed = false,
  overlay = false,
  leaving = false,
}) {
  return (
    <div
      className={[
        "s7-loader",
        `s7-loader--${motion}`,
        framed ? "s7-loader--framed" : "",
        overlay ? "s7-loader--overlay" : "",
        leaving ? "is-leaving" : "",
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="s7-loader__stage" aria-hidden="true">
        <span className="s7-loader__mark">
          <span className="s7-loader__palm" style={PALM_MASK} />
        </span>
        <i className="s7-loader__shadow" />
      </span>
    </div>
  );
}

export function ProposalLoaderGallery() {
  return (
    <div className="s7-loader-gallery">
      <div className="s7-loader-gallery__item">
        <ProposalLoader motion="lift" framed />
        <span>Lift</span>
      </div>
      <div className="s7-loader-gallery__item">
        <ProposalLoader motion="sway" framed />
        <span>Sway</span>
      </div>
      <div className="s7-loader-gallery__item">
        <ProposalLoader motion="drift" framed />
        <span>Drift</span>
      </div>
    </div>
  );
}
