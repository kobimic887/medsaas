import * as React from 'react';
import { MessageCard } from 'medsaas-web';
import { Button } from '@material-tailwind/react';

const avatar = (initial: string, color: string) =>
  `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' rx='8' fill='${encodeURIComponent(color)}'/><text x='24' y='31' font-size='20' fill='white' text-anchor='middle' font-family='sans-serif'>${initial}</text></svg>`;

export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <MessageCard
      img={avatar('SA', '#4caf50')}
      name="Sarah Adams"
      message="Hey! Your glioblastoma prediction run just finished — 3 candidates passed ADMET."
    />
  </div>
);

export const WithAction = () => (
  <div style={{ maxWidth: 420 }}>
    <MessageCard
      img={avatar('RT', '#0288d1')}
      name="Raj Tomar"
      message="Shared the docking results with your team."
      action={
        <Button variant="text" size="sm" color="blue-gray">
          Reply
        </Button>
      }
    />
  </div>
);

export const List = () => (
  <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20 }}>
    <MessageCard img={avatar('SA', '#4caf50')} name="Sarah Adams" message="Run finished — 3 candidates passed." />
    <MessageCard img={avatar('RT', '#0288d1')} name="Raj Tomar" message="Shared the docking results." />
    <MessageCard img={avatar('MK', '#7b1fa2')} name="Mara Klein" message="Can you re-run with the updated target?" />
  </div>
);
