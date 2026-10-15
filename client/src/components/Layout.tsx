import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/useAuth";
import { useInstance } from "./InstanceProvider";
import { ConnectionPill } from "./ConnectionPill";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  History,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  Send,
  Settings,
  Users,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/status", label: "Publicar status", icon: Send },
  { href: "/historico", label: "Histórico", icon: History },
  { href: "/contatos", label: "Contatos", icon: Users },
  { href: "/mensagens", label: "Mensagens", icon: MessageSquare },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? location === "/" : location.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function InstanceSwitcher() {
  const { instances, selected, selectInstance, isLoading } = useInstance();

  if (isLoading) return <div className="h-9 w-full animate-pulse rounded-md bg-muted/60" />;
  if (!selected) return null;
  if (instances.length === 1) {
    return (
      <div className="truncate rounded-md border border-border bg-background/60 px-3 py-2 text-sm">
        <span className="text-caption block text-muted-foreground">Instância</span>
        <span className="font-medium">{selected.label}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor="instance-switcher" className="text-caption text-muted-foreground">
        Instância ativa
      </label>
      <Select
        id="instance-switcher"
        value={selected.id}
        onChange={(e) => selectInstance(e.target.value)}
      >
        {instances.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The authenticated shell: fixed sidebar, topbar with the active instance and
 * its connection state, and the page body. Every protected page renders inside
 * it, so navigation and identity never differ between screens.
 */
export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { selected, hasNone } = useInstance();
  const [, navigate] = useLocation();

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Sidebar */}
      <aside className="hidden border-r border-border/70 bg-card/40 lg:flex lg:flex-col lg:gap-6 lg:p-5">
        <Link href="/" className="focus-ring flex items-center gap-3 rounded-lg p-2">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Megaphone className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight tracking-tight">Painel WhatsApp</span>
            <span className="text-caption block text-muted-foreground">Status via WAME API</span>
          </span>
        </Link>

        <InstanceSwitcher />
        <NavLinks />

        <div className="mt-auto space-y-3 border-t border-border/70 pt-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.name ?? "Operador"}</p>
            <p className="truncate text-caption text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={onLogout}>
            <LogOut className="size-4" />
            Sair
          </Button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="focus-ring flex items-center gap-2 rounded-lg lg:hidden">
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Megaphone className="size-4" />
              </span>
              <span className="text-sm font-semibold">Painel WhatsApp</span>
            </Link>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {selected && <span className="hidden text-caption text-muted-foreground sm:inline">{selected.label}</span>}
              <ConnectionPill />
            </div>
          </div>
          {/* Mobile navigation: a horizontal rail keeps every route reachable
              without a drawer, so no page is a dead end on a phone. */}
          <div className="overflow-x-auto border-t border-border/70 px-2 py-2 lg:hidden">
            <div className="flex gap-1">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="focus-ring whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          {hasNone && <NoInstanceNotice />}
          {children}
        </main>

        <footer className="border-t border-border/60 px-4 py-4 sm:px-6">
          <p className="text-caption text-muted-foreground">
            Painel independente que integra a API da WAME (camada não oficial). Não afiliado, endossado ou
            suportado pela WhatsApp ou pela Meta — o uso é de responsabilidade de quem publica.
          </p>
        </footer>
      </div>
    </div>
  );
}

/** Rendered on every page while the account has no instance configured. */
function NoInstanceNotice() {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
      <p className="text-sm font-semibold text-warning">Nenhuma instância configurada</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Informe a chave da sua instância WAME em Configurações para poder publicar em Status e enviar mensagens.
      </p>
      <Button asChild size="sm" className="mt-3">
        <Link href="/configuracoes">Ir para Configurações</Link>
      </Button>
    </div>
  );
}
