import type { ReactNode } from "react";
import { Route, Switch, Redirect } from "wouter";
import { useAuth } from "./_core/useAuth";
import { Layout } from "./components/Layout";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import StatusComposer from "./pages/StatusComposer";
import StatusHistory from "./pages/StatusHistory";
import Contacts from "./pages/Contacts";
import Messages from "./pages/Messages";
import Settings from "./pages/Settings";

/**
 * Route guard: anonymous users go to /login.
 *
 * Depends only on useAuth — never on the session mechanism. The redirect is
 * declarative (render a <Redirect> once we know there is no user) so it never
 * races the auth query and bounces a signed-in operator back to the form.
 */
function Protected({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2.5 animate-pulse rounded-full bg-primary" />
          Carregando o painel…
        </div>
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <Layout>{children}</Layout>;
}

/** Every authenticated page, so no route can forget the guard or the shell. */
function Page({ children }: { children: ReactNode }) {
  return <Protected>{children}</Protected>;
}

export default function App() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />

      <Route path="/">
        <Page>
          <Home />
        </Page>
      </Route>
      <Route path="/status">
        <Page>
          <StatusComposer />
        </Page>
      </Route>
      <Route path="/historico">
        <Page>
          <StatusHistory />
        </Page>
      </Route>
      <Route path="/contatos">
        <Page>
          <Contacts />
        </Page>
      </Route>
      <Route path="/mensagens">
        <Page>
          <Messages />
        </Page>
      </Route>
      <Route path="/configuracoes">
        <Page>
          <Settings />
        </Page>
      </Route>

      <Route>
        {() => (
          <div className="grid min-h-screen place-items-center p-6">
            <div className="max-w-md space-y-3 text-center">
              <p className="text-subheading text-muted-foreground">Erro 404</p>
              <h1>Esta página não existe</h1>
              <p className="text-body text-muted-foreground">
                O endereço não corresponde a nenhuma tela do painel. Volte para a visão geral para continuar
                publicando.
              </p>
              <a
                href="/"
                className="focus-ring inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Ir para a visão geral
              </a>
            </div>
          </div>
        )}
      </Route>
    </Switch>
  );
}
