export const getEnv = (varName: string) => {
  const val = process.env[varName];
  if (!val) {
    throw new Error(`${varName} is empty`);
  }
  return val!;
};

export function getHashCode(max: number): number {
  return Math.floor(Math.random() * max);
}

const getTimeString = () => {
  const date = new Date();
  const yyyy = date.getFullYear().toString();
  const MM = pad(date.getMonth() + 1, 2);
  const dd = pad(date.getDate(), 2);
  const hh = pad(date.getHours(), 2);
  const mm = pad(date.getMinutes(), 2);
  const ss = pad(date.getSeconds(), 2);
  return yyyy + MM + dd + hh + mm + ss;
};

const pad = (n: number, l: number) => {
  let str = '' + n;
  while (str.length < l) {
    str = '0' + str;
  }
  return str;
};

export default getTimeString;
