import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 文档真实性护栏（v0.0.15 P1）
 *
 * ## 这条护栏防的是什么
 *
 * README 原本有一条对外的绝对表述：
 *
 *   > 「**未复制**原站的私有源码、商标素材、用户数据或社区内容」
 *   > 「仓库内所有代码、文档与数据均为本项目**独立编写 / 采集**」
 *
 * 单看每一句都"是项目想表达的立场"，但合起来会被读成
 * **「整个 Git 历史从未包含过第三方材料」** —— 而那不是事实：
 * 项目最早期把原站的 HTML / CSS / JS 快照与像素级参考截图提交进过仓库，
 * 至今仍可经 4 个早期 Tag / 6 个历史分支 / 8 个已合并 PR 的 ref 取回。
 *
 * 这类表述的危害不在于"写错一个词"，而在于它让读者**无法分辨**：
 *   · 当前源码树干不干净？
 *   · 当前发行的镜像/安装包干不干净？
 *   · 历史里有没有过？
 *   · 那些历史提交今天还取不取得到？
 *
 * 四个问题的答案**不一样**，必须分开说。合并成一句绝对表述，
 * 无论怎么措辞都会在某一层上说假话。
 *
 * ## 判据
 *
 * 1. README 必须**同时**声明四层（当前树 / 当前发行物 / 早期历史 / 今日可达性）；
 * 2. README 不得再出现「未复制……或社区内容」这类**无历史限定**的绝对表述；
 * 3. 声明里必须出现「不表示整个 Git 历史从未包含」这类**显式限定**；
 * 4. 必须指向 R-01 的详细调查文档（可复核，而不是靠这句声明自证）。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const README = read('README.md');
const REVIEW = read('docs/R01_COMPLIANCE_REVIEW_v0.0.15.md');

describe('文档真实性：第三方素材必须分层陈述（v0.0.15）', () => {
  it('README 必须区分「当前树 / 当前发行物 / 早期历史 / 今日可达性」四层', () => {
    // 四个层的标志性措辞，缺任何一层就说明又被合并成了一句
    const layers = [
      { key: '当前源码树', re: /当前\s*`?master`?\s*的源码树|当前 `master` 的代码/ },
      { key: '当前发行物', re: /当前发布的镜像与安装包|当前发行的/ },
      { key: '早期历史提交', re: /早期的?\s*Git\s*历史|最早期/ },
      { key: '今日可达性', re: /仍可达|仍可经|今天是否可达/ },
    ];
    for (const { key, re } of layers) {
      expect(README, `README 缺少「${key}」这一层的陈述 —— 四层不可合并成一句`).toMatch(re);
    }
  });

  it('README 不得再出现「未复制……社区内容」这类无历史限定的绝对表述', () => {
    // 这是**被删除的原话**。它的问题是：它讲的是"从来没有"，而不只是"现在没有"。
    expect(
      README,
      'README 不得再写「未复制原站的私有源码、商标素材、用户数据或社区内容」（那是无历史限定的绝对表述）',
    ).not.toContain('未复制**原站的私有源码、商标素材、用户数据或社区内容');
    expect(
      README,
      'README 不得再写「仓库内所有代码、文档与数据均为本项目独立编写 / 采集」',
    ).not.toContain('仓库内所有代码、文档与数据均为本项目');
  });

  it('README 必须显式声明「不表示整个 Git 历史从未包含」这一限定', () => {
    expect(
      README,
      'README 必须显式否定「整个历史从未包含」这一点，否则读者仍会误读',
    ).toMatch(/不表示[\s\S]{0,40}整个\s*Git\s*历史[\s\S]{0,20}从未/);
    expect(README, 'README 必须说明技术清理 ≠ 版权授权').toMatch(
      /不把技术清理等同于版权授权|技术清理\s*[≠!=]+\s*版权授权/,
    );
  });

  it('README 必须指向 R-01 的可复核调查文档（不能只靠自己声明）', () => {
    expect(
      README,
      'README 必须链接到 R-01 的详细调查（自证式的声明不算证据）',
    ).toContain('docs/R01_COMPLIANCE_REVIEW_v0.0.15.md');
  });

  it('R-01 调查文档必须给出两个口径且说明用途', () => {
    // 「68 / 81」曾一度被混用，导致自证矛盾。文档必须把口径讲清。
    expect(REVIEW, 'R-01 文档必须给出第三方素材口径（68）').toContain('68');
    expect(REVIEW, 'R-01 文档必须给出证据文件总数口径（81）').toContain('81');
    expect(REVIEW, 'R-01 文档必须说明"可达性判定只用口径 ①"').toMatch(
      /可达性判定只用(口径)?\s*①|判定用口径\s*①/,
    );
  });

  it('R-01 调查文档必须披露「四层」中最重要的三条不可撤回风险', () => {
    for (const marker of ['已 fork', 'CDN', '已下载']) {
      expect(REVIEW, `R-01 文档必须披露不可撤回风险：${marker}`).toContain(marker);
    }
    // 必须明确"技术清理 ≠ 获得版权授权"
    expect(REVIEW).toMatch(/技术清理\s*(≠|不等于)\s*(获得)?版权授权|不是法律意见/);
  });

  it('R-01 调查文档必须声明本轮没有执行任何远端不可逆操作', () => {
    expect(REVIEW, 'R-01 文档必须声明未改写历史 / 未移动 Tag').toMatch(
      /未改写历史|未改写任何远端/,
    );
    expect(REVIEW, 'R-01 文档必须声明未移动/删除 Tag').toMatch(/未移动\s*\/?\s*删除任何 Tag|未移动/);
    expect(REVIEW, 'R-01 文档必须声明仓库保持 Public').toContain('Public');
  });
});
