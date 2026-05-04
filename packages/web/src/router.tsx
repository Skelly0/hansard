import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';
import { Shell } from './components/layout/Shell';
import { RouteGuard } from './components/auth/RouteGuard';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Tickets } from './pages/Tickets';
import { TicketDetail } from './pages/TicketDetail';
import { Bills } from './pages/Bills';
import { BillDetail } from './pages/BillDetail';
import { Documents } from './pages/Documents';
import { Voting } from './pages/Voting';
import { ElectionDetail } from './pages/ElectionDetail';
import { Offices } from './pages/Offices';
import { Players } from './pages/Players';
import { Parties } from './pages/Parties';
import { CharacterDossier } from './pages/CharacterDossier';
import { Moderation } from './pages/Moderation';
import { Graveyard } from './pages/Graveyard';
import { Favours } from './pages/Favours';
import { Simulation } from './pages/Simulation';

const rootRoute = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

// /login is the only unauthenticated route
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

// Layout route applying RouteGuard to all protected pages
const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: () => (
    <RouteGuard>
      <Outlet />
    </RouteGuard>
  ),
});

// Nested layout route: protected + staff
const moderationLayoutRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  id: 'moderation-protected',
  component: () => (
    <RouteGuard requireStaff>
      <Outlet />
    </RouteGuard>
  ),
});

// Page routes — most are children of protectedLayoutRoute
const dashboardRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/',
  component: Dashboard,
});

const ticketsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/tickets',
  component: Tickets,
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/tickets/$id',
  component: TicketDetail,
});

const billsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/bills',
  component: Bills,
});

const billDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/bills/$slug',
  component: BillDetail,
});

const documentsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/documents',
  component: Documents,
});

const votingRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/voting',
  component: Voting,
});

const electionDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/voting/$id',
  component: ElectionDetail,
});

const officesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/offices',
  component: Offices,
});

const playersRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/players',
  component: Players,
});

const playerDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/players/$id',
  component: CharacterDossier,
});

const favoursRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/favours',
  component: Favours,
});

const partiesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/parties',
  component: Parties,
});

const simulationRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/simulation',
  component: Simulation,
});

const graveyardRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/graveyard',
  component: Graveyard,
});

// Moderation gets the staff guard
const moderationRoute = createRoute({
  getParentRoute: () => moderationLayoutRoute,
  path: '/moderation',
  component: Moderation,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedLayoutRoute.addChildren([
    dashboardRoute,
    ticketsRoute,
    ticketDetailRoute,
    billsRoute,
    billDetailRoute,
    documentsRoute,
    votingRoute,
    electionDetailRoute,
    officesRoute,
    playersRoute,
    playerDetailRoute,
    favoursRoute,
    partiesRoute,
    simulationRoute,
    graveyardRoute,
    moderationLayoutRoute.addChildren([
      moderationRoute,
    ]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
