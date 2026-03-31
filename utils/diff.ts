export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function diffWords(oldStr: string, newStr: string): DiffPart[] {
  const tokenize = (str: string): string[] => str.match(/\S+|\s+/g) ?? [];
  const oldWords = tokenize(oldStr);
  const newWords = tokenize(newStr);

  const m = oldWords.length;
  const n = newWords.length;
  
  if (m === 0 && oldStr.length === 0) return [{ value: newStr, added: true }];
  if (n === 0 && newStr.length === 0) return [{ value: oldStr, removed: true }];

  // LCS Matrix
  const C: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        C[i][j] = C[i - 1][j - 1] + 1;
      } else {
        C[i][j] = Math.max(C[i][j - 1], C[i - 1][j]);
      }
    }
  }

  const result: DiffPart[] = [];
  let i = m, j = n;
  
  // Backtrack
  while (i > 0 && j > 0) {
    if (oldWords[i - 1] === newWords[j - 1]) {
      result.unshift({ value: oldWords[i - 1] });
      i--;
      j--;
    } else if (C[i - 1][j] > C[i][j - 1]) {
      result.unshift({ value: oldWords[i - 1], removed: true });
      i--;
    } else {
      result.unshift({ value: newWords[j - 1], added: true });
      j--;
    }
  }

  while (i > 0) {
    result.unshift({ value: oldWords[i - 1], removed: true });
    i--;
  }
  while (j > 0) {
    result.unshift({ value: newWords[j - 1], added: true });
    j--;
  }

  return result;
}
