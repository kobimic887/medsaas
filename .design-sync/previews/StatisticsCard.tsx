import * as React from 'react';
import { StatisticsCard } from 'medsaas-web';
import { Typography } from '@material-tailwind/react';

const Icon = ({ d }: { d: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-white">
    <path d={d} />
  </svg>
);

const beaker = 'M9 2a1 1 0 000 2v6.764a2 2 0 01-.293 1.043l-4.43 7.176A2 2 0 006 22h12a2 2 0 001.723-3.017l-4.43-7.176A2 2 0 0115 10.764V4a1 1 0 100-2H9z';
const coin = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-1.5h2V17zm0-3h-2V7h2v7z';
const users = 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z';

const Footer = ({ pct, label }: { pct: string; label: string }) => (
  <Typography variant="small" className="font-normal text-blue-gray-600">
    <strong className="text-green-500">{pct}</strong>&nbsp;{label}
  </Typography>
);

export const Default = () => (
  <div style={{ maxWidth: 320 }}>
    <StatisticsCard
      color="gray"
      icon={<Icon d={coin} />}
      title="Today's Credits Used"
      value="1,240"
      footer={<Footer pct="+12%" label="than last week" />}
    />
  </div>
);

export const Colors = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 240px)', gap: 24 }}>
    <StatisticsCard color="green" icon={<Icon d={beaker} />} title="Simulations" value="3,610" footer={<Footer pct="+5%" label="than yesterday" />} />
    <StatisticsCard color="blue" icon={<Icon d={users} />} title="Active Users" value="2,300" footer={<Footer pct="+3%" label="than last month" />} />
    <StatisticsCard color="pink" icon={<Icon d={coin} />} title="Revenue" value="$53k" footer={<Footer pct="+1%" label="than yesterday" />} />
    <StatisticsCard color="orange" icon={<Icon d={beaker} />} title="ADMET Jobs" value="924" footer={<Footer pct="+8%" label="this week" />} />
  </div>
);
