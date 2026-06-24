import * as React from 'react';
import { ProfileInfoCard } from 'medsaas-web';
import { Tooltip, Typography } from '@material-tailwind/react';

export const Default = () => (
  <div style={{ maxWidth: 480 }}>
    <ProfileInfoCard
      title="Profile Information"
      description="Research lead focused on small-molecule oncology pipelines. Coordinates ADMET and docking runs across the team."
      details={{
        'first name': 'Sarah Adams',
        mobile: '(44) 123 1234 123',
        email: 'sarah.adams@chembench.io',
        location: 'London, UK',
      }}
    />
  </div>
);

export const DescriptionOnly = () => (
  <div style={{ maxWidth: 480 }}>
    <ProfileInfoCard
      title="About"
      description="ChemBench gives computational chemists a single dashboard for generation, folding, docking and ADMET — with per-company branding."
    />
  </div>
);

export const WithAction = () => (
  <div style={{ maxWidth: 480 }}>
    <ProfileInfoCard
      title="Company"
      action={
        <Tooltip content="Edit">
          <Typography as="span" variant="small" color="blue-gray" className="cursor-pointer font-semibold">
            Edit
          </Typography>
        </Tooltip>
      }
      details={{
        company: 'Outwize Inc',
        plan: 'Professional',
        seats: '12 of 20 used',
      }}
    />
  </div>
);
