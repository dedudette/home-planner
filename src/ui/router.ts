import { useEffect, useState } from 'react';

export interface Route { path: string; query: URLSearchParams }

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, q = ''] = raw.split('?');
  return { path: path || '', query: new URLSearchParams(q) };
};

export const useRoute = (): Route => {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
};

export const navigate = (to: string) => { window.location.hash = `#/${to}`; };
