/** Left-nav structure, grouped by product phase. Also drives the ⌘K palette. */
import {
  LayoutDashboard, Users, ShieldCheck, Tags, Package, Star, ShoppingCart,
  Beef, Tractor, HardHat, CalendarCheck, MessageSquare, MessagesSquare, UsersRound,
  Cpu, Coins, FlaskConical, Activity, Landmark, IndianRupee, Sprout, Bug, RefreshCw,
  Megaphone, Flag, Fingerprint, ShieldAlert, FileCheck2, Trash2, History,
  ToggleRight, HeartPulse, ListChecks, SlidersHorizontal, UserCog, Undo2, type LucideIcon,
  ToggleRight, HeartPulse, ListChecks, SlidersHorizontal, UserCog, Wallet, type LucideIcon,
} from 'lucide-react';

/** `scope`, when set, gates the item/group to admins holding that RBAC sub-scope. */
export interface NavItem { label: string; to: string; icon: LucideIcon; keywords?: string; scope?: string }
export interface NavGroup { title: string; items: NavItem[]; scope?: string }

export const NAV: NavGroup[] = [
  { title: 'Overview', items: [
    { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  ]},
  { title: 'Users & Identity', items: [
    { label: 'Users', to: '/users', icon: Users, keywords: 'farmer seller account' },
    { label: 'KYC / Sellers', to: '/kyc', icon: ShieldCheck, keywords: 'verify aadhaar bank' },
  ]},
  { title: 'Marketplace', items: [
    { label: 'Categories', to: '/categories', icon: Tags },
    { label: 'Products', to: '/products', icon: Package },
    { label: 'Reviews', to: '/reviews', icon: Star },
    { label: 'Orders', to: '/orders', icon: ShoppingCart, keywords: 'gmv refund payment' },
    { label: 'Returns', to: '/returns', icon: Undo2, keywords: 'rma refund return reject approve', scope: 'SUPPORT' },
  ]},
  { title: 'Finance', scope: 'FINANCE', items: [
    { label: 'Finance', to: '/finance', icon: Wallet, scope: 'FINANCE', keywords: 'payout settlement ledger seller commission balance reference' },
  ]},
  { title: 'Rentals & Trade', items: [
    { label: 'Animals', to: '/animals', icon: Beef },
    { label: 'Machinery', to: '/machinery', icon: Tractor },
    { label: 'Labour', to: '/labour', icon: HardHat },
    { label: 'Bookings', to: '/bookings', icon: CalendarCheck },
  ]},
  { title: 'Community', items: [
    { label: 'Posts', to: '/posts', icon: MessageSquare },
    { label: 'Comments', to: '/comments', icon: MessagesSquare },
    { label: 'Groups', to: '/groups', icon: UsersRound },
  ]},
  { title: 'AI Operations', items: [
    { label: 'Usage & Cost', to: '/ai/usage', icon: Cpu, keywords: 'tokens cost' },
    { label: 'Credits', to: '/ai/credits', icon: Coins, keywords: 'ledger grant deduct' },
    { label: 'Retrain Queue', to: '/ai/feedback', icon: FlaskConical, keywords: 'disease feedback' },
    { label: 'Disease Reports', to: '/ai/reports', icon: Activity },
  ]},
  { title: 'Content (CMS)', items: [
    { label: 'Govt Schemes', to: '/schemes', icon: Landmark },
    { label: 'MSP Rates', to: '/msp', icon: IndianRupee },
    { label: 'Crop Master', to: '/crop-master', icon: Sprout },
    { label: 'Pest Alerts', to: '/pest-alerts', icon: Bug },
    { label: 'Mandi Sync', to: '/mandi-sync', icon: RefreshCw },
  ]},
  { title: 'Broadcast', items: [
    { label: 'Notifications', to: '/broadcast', icon: Megaphone, keywords: 'push send audience' },
  ]},
  { title: 'Trust & Safety', items: [
    { label: 'Moderation', to: '/moderation', icon: Flag },
    { label: 'Fraud Clusters', to: '/fraud', icon: Fingerprint, keywords: 'device multi-account' },
    { label: 'Incidents', to: '/incidents', icon: ShieldAlert, keywords: 'breach dpdp sla' },
  ]},
  { title: 'Compliance (DPDP)', items: [
    { label: 'Consents', to: '/consents', icon: FileCheck2 },
    { label: 'Erasure', to: '/erasure', icon: Trash2, keywords: 'right to be forgotten' },
    { label: 'Audit Log', to: '/audit', icon: History },
  ]},
  { title: 'Ops', items: [
    { label: 'Feature Flags', to: '/flags', icon: ToggleRight },
    { label: 'API Health', to: '/health', icon: HeartPulse },
    { label: 'Queues', to: '/queues', icon: ListChecks },
  ]},
  { title: 'Team & Access', scope: 'SUPER_ADMIN', items: [
    { label: 'Team', to: '/team', icon: UserCog, scope: 'SUPER_ADMIN', keywords: 'admin roles scopes invite revoke rbac permissions' },
  ]},
  { title: 'Settings', scope: 'SUPER_ADMIN', items: [
    { label: 'App Settings', to: '/settings', icon: SlidersHorizontal, scope: 'SUPER_ADMIN', keywords: 'config env budget token limit secret runtime commission ai model gemini openai claude groq' },
  ]},
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);
