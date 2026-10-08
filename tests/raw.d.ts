// Lets a test read a file as text through Vite (`import text from './file.md?raw'`) without needing Node's types.
declare module '*?raw' {
  const text: string;
  export default text;
}
