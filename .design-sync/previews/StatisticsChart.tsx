import * as React from 'react';
import { StatisticsChart } from 'medsaas-web';
import { Typography } from '@material-tailwind/react';

const chartsConfig = {
  // animations disabled so the static screenshot captures the fully-drawn
  // series (entry animation otherwise renders bars/line at zero).
  chart: { toolbar: { show: false }, animations: { enabled: false } },
  dataLabels: { enabled: false },
  xaxis: {
    axisTicks: { show: false },
    axisBorder: { show: false },
    labels: { style: { colors: '#37474f', fontSize: '13px', fontFamily: 'inherit', fontWeight: 300 } },
  },
  yaxis: { labels: { style: { colors: '#37474f', fontSize: '13px', fontFamily: 'inherit', fontWeight: 300 } } },
  grid: { show: true, borderColor: '#dddddd', strokeDashArray: 5, xaxis: { lines: { show: true } }, padding: { top: 5, right: 20 } },
  fill: { opacity: 0.8 },
  tooltip: { theme: 'dark' },
};

const Footer = ({ text }: { text: string }) => (
  <Typography variant="small" className="flex items-center font-normal text-blue-gray-600">
    {text}
  </Typography>
);

export const BarChart = () => (
  <div style={{ maxWidth: 360 }}>
    <StatisticsChart
      color="white"
      title="Weekly Simulations"
      description="Runs submitted per day"
      footer={<Footer text="updated 4 min ago" />}
      chart={{
        type: 'bar',
        height: 220,
        series: [{ name: 'Runs', data: [50, 20, 10, 22, 50, 10, 40] }],
        options: {
          ...chartsConfig,
          colors: '#388e3c',
          plotOptions: { bar: { columnWidth: '16%', borderRadius: 5 } },
          xaxis: { ...chartsConfig.xaxis, categories: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] },
        },
      }}
    />
  </div>
);

export const LineChart = () => (
  <div style={{ maxWidth: 360 }}>
    <StatisticsChart
      color="white"
      title="Daily Credits"
      description="15% increase in today's usage"
      footer={<Footer text="updated 1 min ago" />}
      chart={{
        type: 'line',
        height: 220,
        series: [{ name: 'Credits', data: [50, 40, 300, 320, 500, 350, 200, 230, 500] }],
        options: {
          ...chartsConfig,
          colors: ['#0288d1'],
          stroke: { lineCap: 'round' },
          markers: { size: 5 },
          xaxis: { ...chartsConfig.xaxis, categories: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] },
        },
      }}
    />
  </div>
);
