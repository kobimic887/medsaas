import * as React from 'react';
import { Sidenav } from 'medsaas-web';

const Icon = ({ d }: { d: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d={d} />
  </svg>
);

const home = 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z';
const chart = 'M5 9.2h3V19H5zM10.6 5h3v14h-3zm5.6 8H19v6h-2.8z';
const beaker = 'M9 2a1 1 0 000 2v6.764a2 2 0 01-.293 1.043l-4.43 7.176A2 2 0 006 22h12a2 2 0 001.723-3.017l-4.43-7.176A2 2 0 0115 10.764V4a1 1 0 100-2H9z';
const cog = 'M19.14 12.94a7.99 7.99 0 000-1.88l2.03-1.58-2-3.46-2.39.96a8 8 0 00-1.62-.94l-.36-2.54h-4l-.36 2.54c-.58.23-1.12.55-1.62.94l-2.39-.96-2 3.46 2.03 1.58a7.99 7.99 0 000 1.88L2.96 14.5l2 3.46 2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54h4l.36-2.54c.58-.23 1.12-.55 1.62-.94l2.39.96 2-3.46-2.03-1.56zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z';

const routes = [
  {
    layout: 'dashboard',
    title: 'overview',
    pages: [
      { icon: <Icon d={home} />, name: 'home', path: '/home' },
      { icon: <Icon d={chart} />, name: 'analytics', path: '/analytics' },
      { icon: <Icon d={beaker} />, name: 'simulations', path: '/simulations' },
    ],
  },
  {
    layout: 'dashboard',
    title: 'account',
    pages: [
      { icon: <Icon d={cog} />, name: 'settings', path: '/settings' },
    ],
  },
];

export const Default = () => <Sidenav brandName="ChemBench" routes={routes} />;
