import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';
import { Shell } from './components/layout/Shell';
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

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

const ticketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets',
  component: Tickets,
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets/$id',
  component: TicketDetail,
});

const billsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bills',
  component: Bills,
});

const billDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bills/$slug',
  component: BillDetail,
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  component: Documents,
});

const votingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/voting',
  component: Voting,
});

const electionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/voting/$id',
  component: ElectionDetail,
});

const officesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/offices',
  component: Offices,
});

const playersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/players',
  component: Players,
});

const playerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/players/$id',
  component: CharacterDossier,
});

const favoursRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/favours',
  component: Favours,
});

const simulationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/simulation',
  component: Simulation,
});

const moderationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/moderation',
  component: Moderation,
});

const graveyardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/graveyard',
  component: Graveyard,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  loginRoute,
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
  simulationRoute,
  moderationRoute,
  graveyardRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
