import React from "react";
import { ArrowLeft } from "lucide-react";

export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-white px-6 dark:bg-[#0b0b0c]">
        <div className="max-w-sm text-center">
          <p className="text-sm text-slate-600 dark:text-zinc-400">
            This proposal could not be opened. Go back and try again.
          </p>
          <a
            href={this.props.fallbackHref || "/proposals"}
            className="mt-4 inline-flex items-center rounded-[7px] border border-black/10 px-3 py-2 text-sm dark:border-white/15"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to proposals
          </a>
        </div>
      </div>
    );
  }
}
