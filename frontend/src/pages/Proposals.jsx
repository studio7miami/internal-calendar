import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Archive, CheckCircle2, Copy, FileText, Layers, MessageSquare, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Send } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import {
  normalizeProposal,
  normalizeProposalList,
  proposalActionPayload,
  proposalFilterLabel,
  proposalMatchesFilter,
  serializeProposal,
  statusLabel,
  isBlankProposal,
} from "../lib/proposals";
import { luisLiveDraft, isLuisProposal } from "../lib/liveLuisProposal";
import { getProposalStage } from "../lib/proposalStatusTheme";
import { proposalGlance } from "../lib/proposalGlance";
import SignPayLinkModal from "../components/proposals/SignPayLinkModal";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { cn } from "../lib/utils";
import { pageBtnOutlineClass, pageTitleClass } from "../lib/pageTheme";
import { useAuth } from "../context/AuthContext";

const FILTER_TABS = [
  { value: "all", label: "All", Icon: Layers },
  { value: "draft", label: "Draft", Icon: FileText },
  { value: "shared", label: "Shared", Icon: Send },
  { value: "won", label: "Won", Icon: CheckCircle2 },
  { value: "changes_requested", label: "Changes", Icon: MessageSquare },
  { value: "archived", label: "Archive", Icon: Archive },
];

function CardShell({ className, children }) {
  return (
    <motion.article
      className={cn("cursor-pointer", className)}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.55 }}
    >
      {children}
    </motion.article>
  );
}

export default function Proposals() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [proposals, setProposals] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [signPayModal, setSignPayModal] = useState(null);
  const can = (permission) => user?.role === "admin" || !!user?.permissions?.[permission];
  const canCreate = can("edit_proposals");
  const seededLuis = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/proposals");
      let list = normalizeProposalList(data).filter((proposal) => !isBlankProposal(proposal));
      const canEdit = user?.role === "admin" || !!user?.permissions?.edit_proposals;
      if (canEdit && !list.some(isLuisProposal) && !seededLuis.current) {
        seededLuis.current = true;
        try {
          const { data: created } = await api.post(
            "/proposals",
            serializeProposal(normalizeProposal(luisLiveDraft()), { includeVersion: false }),
          );
          list = [normalizeProposal(created), ...list];
        } catch {
          seededLuis.current = false;
        }
      }
      setProposals(list);
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Could not load proposals.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return proposals
      .filter((proposal) => {
        const matchesFilter = proposalMatchesFilter(filter, proposal.status);
        const haystack = [
          proposal.title,
          proposal.client?.contact_name,
          proposal.owner?.name,
          proposal.owner_name,
          proposal.assigned_to,
          statusLabel(proposal.status),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return matchesFilter && (!term || haystack.includes(term));
      })
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }, [filter, proposals, search]);

  const create = () => navigate("/proposals/new");

  const act = async (proposal, action) => {
    setWorking(`${proposal.id}:${action}`);
    try {
      const { data } = await api.post(`/proposals/${proposal.id}/${action}`, proposalActionPayload(action, proposal));
      if (action === "duplicate") {
        navigate(`/proposals/${data.id || data.proposal?.id}/edit`);
      } else if (action === "mark-accepted") {
        await load();
        setSignPayModal({
          link: data.share_url || "",
          clientName: data.client_name || proposal.client?.contact_name || "",
          clientPhone: data.client_phone || proposal.client?.phone || "",
        });
      } else {
        await load();
      }
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || `Could not ${action} proposal.`);
    } finally {
      setWorking("");
    }
  };

  const openProposal = (proposal) => navigate(`/proposals/${proposal.id}/edit`);

  return (
    <div className="space-y-7" data-testid="proposals-page">
      <header>
        <div className="label-tech">Workspace</div>
        <h1 className={pageTitleClass}>Proposals</h1>
      </header>

      <div className="flex flex-col gap-3">
        <ProposalToolbar
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          canCreate={canCreate}
          onCreate={create}
        />
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-[7px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={load} aria-label="Retry">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <ProposalListSkeleton />
      ) : visible.length ? (
        <ProposalList
          proposals={visible}
          canEdit={can("edit_proposals")}
          canManage={can("manage_proposals")}
          working={working}
          onOpen={openProposal}
          onAct={act}
        />
      ) : (
        <div className="rounded-[28px] bg-[#F3F2EE] px-8 py-10 text-center dark:bg-white/[0.04]">
          <p className="font-medium">
            {filter === "all" ? "No proposals yet." : `No ${proposalFilterLabel(filter)} proposals.`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {search ? "Try a different search." : "Create a proposal to get started."}
          </p>
        </div>
      )}

      <SignPayLinkModal
        open={!!signPayModal}
        link={signPayModal?.link || ""}
        clientName={signPayModal?.clientName || ""}
        clientPhone={signPayModal?.clientPhone || ""}
        onClose={() => setSignPayModal(null)}
      />
    </div>
  );
}

function PillSearch({ value, onChange }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-[#EFEFEA] px-4 py-2.5 dark:bg-white/[0.06]">
      <Search className="h-4 w-4 shrink-0 text-[#9a9a96]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search client, title, status…"
        className="min-w-0 flex-1 bg-transparent text-sm text-[#111] outline-none placeholder:text-[#9a9a96] dark:text-zinc-100"
      />
    </label>
  );
}

function NewMark({ canCreate, onCreate }) {
  if (!canCreate) return null;
  return (
    <button
      type="button"
      onClick={onCreate}
      aria-label="New proposal"
      className="grid size-11 shrink-0 place-items-center rounded-full bg-[#e2af1d] text-[#111] shadow-[0_8px_18px_rgba(226,175,29,0.35)] transition-transform md:hover:scale-105"
    >
      <Plus className="h-5 w-5" strokeWidth={2.25} />
    </button>
  );
}

function ProposalToolbar({ filter, onFilter, search, onSearch, canCreate, onCreate }) {
  const trackRef = useRef(null);
  const tabRefs = useRef({});
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false });

  const placePill = useCallback(() => {
    const track = trackRef.current;
    const tab = tabRefs.current[filter];
    if (!track || !tab) return;
    setPill({ left: tab.offsetLeft, width: tab.offsetWidth, ready: true });
  }, [filter]);

  useLayoutEffect(() => {
    placePill();
    let frames = 0;
    let frame = 0;
    const follow = () => {
      placePill();
      frames += 1;
      if (frames < 24) frame = window.requestAnimationFrame(follow);
    };
    frame = window.requestAnimationFrame(follow);
    const track = trackRef.current;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(placePill) : null;
    if (track && observer) observer.observe(track);
    window.addEventListener("resize", placePill);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", placePill);
    };
  }, [placePill]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <PillSearch value={search} onChange={onSearch} />
      <div
        ref={trackRef}
        className="relative flex items-center gap-1 overflow-x-auto rounded-full bg-[#F3F2EE] px-1.5 py-1.5 dark:bg-white/[0.05]"
        role="tablist"
        aria-label="Proposal filters"
      >
        <motion.span
          aria-hidden
          className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 rounded-full bg-[#111] dark:bg-white"
          initial={false}
          animate={{
            x: pill.left,
            width: pill.width,
            opacity: pill.ready ? 1 : 0,
          }}
          transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.7 }}
        />
        {FILTER_TABS.map((item) => {
          const on = filter === item.value;
          const { Icon, label } = item;
          return (
            <button
              key={item.value}
              ref={(node) => {
                if (node) tabRefs.current[item.value] = node;
                else delete tabRefs.current[item.value];
              }}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onFilter(item.value)}
              className={cn(
                "relative z-10 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-colors duration-300",
                on ? "text-white dark:text-[#111]" : "text-[#9a9a96] md:hover:text-[#111] dark:md:hover:text-zinc-200",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span
                className={cn(
                  "grid overflow-hidden transition-[grid-template-columns] duration-300 ease-out",
                  on ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
                )}
              >
                <span className="min-w-0 overflow-hidden whitespace-nowrap">{label}</span>
              </span>
            </button>
          );
        })}
        <NewMark canCreate={canCreate} onCreate={onCreate} />
      </div>
    </div>
  );
}

function statusMeta(status) {
  const stage = getProposalStage(status);
  return FILTER_TABS.find((item) => item.value === stage) || FILTER_TABS[1];
}

function StatusMark({ status }) {
  const tab = statusMeta(status);
  const stage = getProposalStage(status);
  const Icon = tab.Icon;
  const tone = {
    won: "bg-[#e2af1d] text-[#111]",
    shared: "bg-[rgba(226,175,29,0.22)] text-[#8A6412]",
    changes_requested: "bg-[#F0D3B0] text-[#8A4A1C]",
    draft: "bg-[#F4E8D2] text-[#8A6A38]",
    archived: "bg-[#EDE4D4] text-[#8A8070]",
  }[stage];
  return (
    <span className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium", tone)}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {tab.label}
    </span>
  );
}

function ProposalListSkeleton() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-[7.5rem] animate-pulse rounded-[28px] bg-[#F3F2EE] dark:bg-white/[0.04]" />
      ))}
    </div>
  );
}

function ProposalList({ proposals, canEdit, canManage, working, onOpen, onAct }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {proposals.map((proposal) => (
        <ProposalBand
          key={proposal.id}
          proposal={proposal}
          canEdit={canEdit}
          canManage={canManage}
          working={working}
          onOpen={onOpen}
          onAct={onAct}
        />
      ))}
    </div>
  );
}

function BoardFact({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#9a9a96]">{label}</p>
      <p className="mt-1 truncate text-[14px] font-semibold text-[#111]">{value}</p>
    </div>
  );
}

function ProposalBand({ proposal, canEdit, canManage, working, onOpen, onAct }) {
  const glance = proposalGlance(proposal);
  const menu = (
    <ProposalActions
      proposal={proposal}
      canEdit={canEdit}
      canManage={canManage}
      working={working}
      onOpen={onOpen}
      onAct={onAct}
      compact
      menuOnly
    />
  );

  return (
    <CardShell className="flex flex-col gap-4 rounded-[28px] bg-[#F3F2EE] p-4 dark:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="min-w-0 text-left" onClick={() => onOpen(proposal)}>
          <p className="truncate font-['Manrope',system-ui,sans-serif] text-[15px] font-semibold leading-tight">
            {glance.client}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-[#6F6F6B]">{glance.title}</p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusMark status={proposal.status} />
          {menu}
        </div>
      </div>
      <button type="button" className="grid grid-cols-3 gap-3 text-left" onClick={() => onOpen(proposal)}>
        <BoardFact label="Session" value={glance.sessionLabel} />
        <BoardFact label="Value" value={glance.value} />
        <BoardFact label="Next" value={glance.nextStep} />
      </button>
    </CardShell>
  );
}

function canMarkAccepted(status) {
  return ["draft", "approved", "sent", "viewed"].includes(status);
}

function ProposalActions({ proposal, canEdit, canManage, working, onOpen, onAct, compact = false, menuOnly = false }) {
  if (!canEdit && !canManage) return null;

  return (
    <div className={cn("flex shrink-0 items-center gap-2", menuOnly && "gap-0")}>
      {canEdit && !menuOnly && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpen(proposal)}
          className={cn(compact ? "hidden sm:inline-flex h-8 px-2 text-xs" : "hidden sm:inline-flex", pageBtnOutlineClass)}
        >
          <Pencil className={cn("mr-2 h-4 w-4", compact && "mr-1 h-3.5 w-3.5")} />
          {proposal.status === "draft" ? "Resume" : "Open"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className={cn(compact || menuOnly ? "h-8 w-8 p-0" : "h-10 w-10 p-0", pageBtnOutlineClass)}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && canMarkAccepted(proposal.status) && (
            <DropdownMenuItem onClick={() => onAct(proposal, "mark-accepted")} disabled={!!working}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Mark accepted
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={() => onAct(proposal, "duplicate")} disabled={!!working}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem onClick={() => onAct(proposal, "archive")} disabled={!!working}>
              <Archive className="mr-2 h-4 w-4" /> Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
