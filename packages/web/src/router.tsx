import {
  createRouter,
  createRootRoute,
  createRoute,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import { Shell } from './components/layout/Shell';
import { RouteGuard } from './components/auth/RouteGuard';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { PageSkeleton } from './components/shared/SkeletonLoader';

// Pages are split into their own chunks so the first paint only downloads the
// shell plus the page being opened. `defaultPreload: 'intent'` below fetches a
// page's chunk as soon as its link is hovered or focused.
const Dashboard = lazyRouteComponent(() => import('./pages/Dashboard'), 'Dashboard');
const Tickets = lazyRouteComponent(() => import('./pages/Tickets'), 'Tickets');
const TicketDetail = lazyRouteComponent(() => import('./pages/TicketDetail'), 'TicketDetail');
const Bills = lazyRouteComponent(() => import('./pages/Bills'), 'Bills');
const BillDetail = lazyRouteComponent(() => import('./pages/BillDetail'), 'BillDetail');
const Documents = lazyRouteComponent(() => import('./pages/Documents'), 'Documents');
const Voting = lazyRouteComponent(() => import('./pages/Voting'), 'Voting');
const ElectionDetail = lazyRouteComponent(() => import('./pages/ElectionDetail'), 'ElectionDetail');
const Offices = lazyRouteComponent(() => import('./pages/Offices'), 'Offices');
const Players = lazyRouteComponent(() => import('./pages/Players'), 'Players');
const Parties = lazyRouteComponent(() => import('./pages/Parties'), 'Parties');
const CharacterDossier = lazyRouteComponent(() => import('./pages/CharacterDossier'), 'CharacterDossier');
const Moderation = lazyRouteComponent(() => import('./pages/Moderation'), 'Moderation');
const Graveyard = lazyRouteComponent(() => import('./pages/Graveyard'), 'Graveyard');
const Favours = lazyRouteComponent(() => import('./pages/Favours'), 'Favours');
const Simulation = lazyRouteComponent(() => import('./pages/Simulation'), 'Simulation');

// Bare root — does NOT mount the app Shell, so unauthenticated routes
// (e.g. /login) get a clean full-screen layout without the sidebar.
const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

// /login is the only unauthenticated route
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

// Layout route applying RouteGuard + the app Shell (sidebar/main) to all
// protected pages. Shell lives here — not on the root — so logged-out users
// never see the sidebar squeezed next to the login card.
const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: () => (
    <RouteGuard>
      <Shell>
        <Outlet />
      </Shell>
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

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: PageSkeleton,
  defaultNotFoundComponent: NotFound,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
