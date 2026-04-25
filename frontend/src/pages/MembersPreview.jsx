import React from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import Members from "./Members";
import { pageSubtextClass, pageTitleClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";

const ROLES = ["member", "manager", "admin"];

/**
 * Dev-only: Members / manager / admin UI with mock data (no API writes).
 * Routes from `App.js` when `NODE_ENV === "development"`.
 */
export default function MembersPreview() {
  const { role } = useParams();
  if (!ROLES.includes(role)) {
    return <Navigate to="/preview/members/member" replace />;
  }

  return (
    <div className="min-h-dvh bg-white text-black dark:bg-[#0b0b0c] dark:text-zinc-200">
      <div className="border-b border-neutral-200 px-4 py-4 dark:border-white/[0.06] md:px-8">
        <div className="label-tech text-slate-900 dark:text-zinc-200">Design preview</div>
        <h1 className={cn(pageTitleClass, "mt-1")}>Members page</h1>
        <p className={cn(pageSubtextClass, "mt-2 max-w-2xl")}>
          Switch role to see invites, permission matrix, and calendar-access UI as that persona. Actions do not call the
          server.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {ROLES.map((r) => (
            <Link
              key={r}
              to={`/preview/members/${r}`}
              className={cn(
                "rounded-[7px] border px-3 py-1.5 transition-colors",
                r === role
                  ? "border-gray-200/95 bg-[#FCFCFC] text-slate-900 dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                  : "border-gray-200/60 text-slate-600 hover:border-gray-200 dark:border-white/10 dark:text-zinc-400 dark:hover:border-white/20"
              )}
            >
              {r}
            </Link>
          ))}
          <Link
            to="/login"
            className="rounded-[7px] border border-transparent px-3 py-1.5 text-slate-500 underline-offset-2 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            Exit preview
          </Link>
        </div>
      </div>
      <div className="px-4 py-6 md:px-8">
        <Members previewRole={role} />
      </div>
    </div>
  );
}
