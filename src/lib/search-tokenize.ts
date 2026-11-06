/**
 * 中文友好的搜索分词（v0.0.5）
 *
 * ## 为什么需要它
 *
 * 原实现是 `ILIKE '%关键词%'`。这对英文没问题，但**中文没有空格分词**：
 * 搜「性能优化」时，`ILIKE` 只能匹配**连续出现**的「性能优化」，
 * 而「数据库性能优化的实践」里的「性能优化」是连续的（能命中），
 * 但「性能与优化」「性能优化实践」这类**中间插了别的字**的就命中不了。
 *
 * 更常见的情况是用户搜**部分关键词**（「优化」）——
 * `ILIKE '%优化%'` 能命中，但搜「性能优化」这类**多词组合**就很脆弱。
 *
 * ## 方案对比（实测结论见 `tests/v005-search-quality.spec.ts`）
 *
 * | 方案 | 中文效果 | 依赖 | 结论 |
 * |---|---|---|---|
 * | `ILIKE` 整串 | 差（必须连续） | 无 | 现状，不够用 |
 * | `pg_trgm` 相似度 | 中（模糊但噪声大） | 需 pg_trgm | 排序辅助可，不能当主条件 |
 * | FTS `simple` | **几乎无用**（不切中文，整句当一词） | 无 | 不可用 |
 * | FTS `zhparser`/`pg_jieba` | 好 | **需装扩展** | ❌ 本机 PG **没有编译这两个扩展** |
 * | **CJK bigram（本模块）** | **好** | **无** | ✅ **采用** |
 *
 * ### 为什么不用中文分词扩展
 *
 * 实测（`pg_available_extensions`）：本机 PostgreSQL **只有 `pg_trgm`**，
 * `zhparser` / `pg_jieba` **未编译进镜像**。
 * 依赖它们意味着「换了 PG 版本 / 用了官方镜像就装不上」——
 * 与任务书「维护成本低、与 Docker 部署兼容」的要求直接冲突。
 *
 * bigram 方案**只用 PostgreSQL 原生能力**（`ILIKE` + 已有的 trigram 索引），
 * 零额外依赖、零部署风险。
 *
 * ## 算法
 *
 * - **CJK 字符**（中日文）：取**相邻二元组**（bigram）
 *   「性能优化」→ 「性能」「能优」「优化」
 * - **拉丁字母 / 数字**：按**非字母数字**边界切成完整词（`optimize` 不被拆）
 * - **其余字符**：忽略
 *
 * ### bigram 为什么够用
 *
 * 1. 覆盖所有连续二元组合 ⇒ 任意子串都能被匹配到
 * 2. 不依赖词典 ⇒ 零维护成本、无新词失效问题
 * 3. 与 trigram 索引天然契合（bigram 串可用 trigram 索引加速）
 *
 * ### 已知取舍
 *
 * - bigram 会产生**假阳性**：搜「性能」会命中含「能优」的文档（若无字级索引）
 *   —— 但这与 `ILIKE` 的语义一致（都是子串匹配），且标题命中会排在前面
 * - 单字中文查询（如「猫」）退化为一字匹配 —— 仍然正确
 */

/** CJK 统一表意文字 + 假名 + 谚文等 */
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** 拉丁字母与数字（连续的一段算一个词） */
const LATIN_PATTERN = /[a-z0-9]+/g;

/**
 * 把查询串切成用于 `ILIKE` 的 token。
 *
 * @param query 原始查询
 * @returns token 数组（已去重、已小写）
 */
export function tokenizeSearchQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens: string[] = [];
  const seen = new Set<string>();

  const push = (t: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };

  // ① 拉丁词 / 数字（长度 ≥ 2，避免单字母噪声）
  for (const m of lower.matchAll(LATIN_PATTERN)) {
    if (m[0].length >= 2) push(m[0]);
  }

  // ② CJK 连续段 → bigram
  for (const m of lower.matchAll(/[぀-ヿ㐀-䶿一-鿿豈-﫿]+/g)) {
    const seg = m[0];
    if (seg.length === 1) {
      push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) {
      push(seg.slice(i, i + 2));
    }
  }

  return tokens;
}

/**
 * token 数量上限 —— 防止超长查询产生过多 SQL 条件。
 *
 * 50 字中文 ⇒ 49 个 bigram；再长就没有实际意义了（用户不会搜那么长）。
 */
export const MAX_SEARCH_TOKENS = 64;

/** 截断 token 列表到上限 */
export function limitSearchTokens(tokens: string[]): string[] {
  return tokens.length > MAX_SEARCH_TOKENS ? tokens.slice(0, MAX_SEARCH_TOKENS) : tokens;
}

/**
 * 把 token 列表转成 `ILIKE` 的匹配模式（已转义 LIKE 元字符）。
 *
 * ⚠️ 转义是**必须的**：用户输入的 `%` / `_` / `\` 若不转义，
 * 就会变成通配符 ⇒ 扫全表（既慢又能被用来探测数据）。
 */
export function toLikePattern(token: string): string {
  const escaped = token.replace(/[%_\\]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/**
 * 关键词匹配模式列表。
 *
 * - **纯 ASCII 关键词**（英文 / 数字）：用**整串**匹配
 *   （bigram 会把 `optimize` 拆成 `op`/`pt`/`ti`… 反而更噪）
 * - **含 CJK 的关键词**：用 bigram token 列表
 *
 * @returns 用于 `ILIKE` 的模式数组（可能为空 —— 表示查询无法分词）
 */
export function buildSearchPatterns(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();

  // ① 纯符号 / 无有效 token ⇒ 无法分词
  //
  // ⚠️ 「!!!」「###」这类输入若按「纯 ASCII 整串匹配」处理，
  // 会生成 `%!!!%` 这样的模式 —— 虽然 LIKE 元字符已转义（不会变成通配符），
  // 但它必然匹配不到任何内容，浪费一次全表扫描。
  //
  // 这里提前判定：既不含 CJK、又没有长度 ≥ 2 的拉丁词 ⇒ 直接返回空。
  const hasCjk = CJK_PATTERN.test(trimmed);
  const hasLatinWord = /[a-z0-9]{2,}/.test(lower);
  if (!hasCjk && !hasLatinWord) {
    return [];
  }

  // ② 纯 ASCII：整串匹配（保持 v0.0.4 的行为，不退化）
  if (!hasCjk) {
    return [toLikePattern(lower)];
  }

  // ③ 含 CJK：整串 + bigram
  const tokens = limitSearchTokens(tokenizeSearchQuery(trimmed));
  if (tokens.length === 0) {
    // 有 CJK 但没产出 token（理论上不会发生 —— 单字 CJK 也会产出 1 个）
    return [toLikePattern(lower)];
  }

  // bigram 之外，也保留**整串**作为一条条件 ——
  // 保证「完整关键词连续出现」的强匹配一定命中（排序上再靠标题加权区分）。
  //
  // ⚠️ 统一用**小写**（ILIKE 本身不区分大小写，但模式保持一致更利于
  //    复用缓存 / 排查问题）。
  const patterns = [toLikePattern(lower)];
  for (const t of tokens) {
    const pat = toLikePattern(t);
    if (!patterns.includes(pat)) patterns.push(pat);
  }
  return patterns;
}

/**
 * **AND 语义**的匹配模式列表（全部 token 都必须命中）
 *
 * ## 为什么需要 AND 版本
 *
 * 实测（`scripts/perf/search-benchmark.ts`，5000 主题规模）：
 *
 * | 策略 | 召回行数 | P50 | P95 |
 * |---|---|---|---|
 * | ILIKE 整串 | 60 | 1ms | 15ms |
 * | bigram **OR**（任一 token 命中） | **5000**（严重假阳性） | 1ms | 1ms |
 * | bigram **AND**（全部 token 命中） | **60**（精度正确） | 15ms | 17ms |
 *
 * OR 策略会把「只含『优化』」的文档全部召回（假阳性）——
 * 因为「数据库性能优化」会产生「数据库」「据库」「库性」「性能」「能优」「优化」
 * 等 token，任一命中即算。
 *
 * AND 策略要求**所有** token 都命中 ⇒ 精度与 ILIKE 整串持平，
 * 但能额外命中「词序被打散」的文档（如「优化…数据库性能」）。
 *
 * ## 生产策略：两阶段搜索
 *
 * 1. **先跑 ILIKE 整串** —— 快、命中 trigram 索引（P50 1ms）
 * 2. **结果不足时回退到 bigram AND** —— 慢一点（P50 15ms）但召回更全
 *
 * 这样既不劣化 v0.0.4 的性能，又能提升中文召回。
 */
export function buildAndSearchPatterns(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const hasCjk = CJK_PATTERN.test(trimmed);
  const hasLatinWord = /[a-z0-9]{2,}/.test(lower);
  if (!hasCjk && !hasLatinWord) return [];

  const tokens = limitSearchTokens(tokenizeSearchQuery(trimmed));
  if (tokens.length === 0) return [];

  return tokens.map(toLikePattern);
}
