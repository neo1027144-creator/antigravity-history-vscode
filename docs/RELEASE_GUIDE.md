# 发版流程：从改动到发布（端到端）

> 本文档描述 antigravity-history-vscode 插件从代码改动到最终发布的完整流程。

## 前提条件

- 本地仓库已配置双 remote：
  - `origin` → 私有仓库 `antigravity-history-vscode-dev`（开发用）
  - `public` → 公开仓库 `antigravity-history-vscode`（展示用）
- 私有仓库已配置两个 GitHub Secrets：
  - `PUBLIC_REPO_TOKEN`：Fine-grained PAT，用于同步到公开仓库
  - `OVSX_TOKEN`：OpenVSX API Token，用于发布插件
- 日常开发**只推 origin**，永远不要手动 `git push public`

---

## 步骤一：完成代码改动

在本地修改代码，确保功能正常。可以用 watch 模式实时编译：

```bash
npm run watch
```

如需本地打包测试：

```bash
npx vsce package --no-yarn --no-update-package-json --out test.vsix
# 然后在 IDE 中：Ctrl+Shift+P → "Install from VSIX" → 选择 test.vsix
```

---

## 步骤二：升级版本号

编辑 `package.json`，递增 `version` 字段：

```json
"version": "0.1.8",   // ← 改这里
```

版本号规则：
- **patch**（0.1.x）：Bug 修复、小改动
- **minor**（0.x.0）：新功能
- **major**（x.0.0）：破坏性变更

---

## 步骤三：提交 Git 记录

```bash
# 添加所有改动
git add -A

# 提交，commit message 遵循 conventional commits 格式
git commit -m "feat: v0.1.8 - 简要描述本次更新内容"
```

常用 commit 前缀：
| 前缀 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `chore:` | 构建/配置变更 |
| `release:` | 版本发布 |

---

## 步骤四：打 Tag 并推送

```bash
# 打版本标签
git tag v0.1.8

# 推送代码 + 标签到私有仓库
git push origin master --tags
```

> ⚠️ **这一步是触发自动化的关键。** 推送到 origin 后，GitHub Actions 会自动执行。

---

## 步骤五：自动化流程（无需手动操作）

推送后，私有仓库上的 GitHub Actions 自动触发两个 Workflow：

### Workflow 1：`sync-public.yml`（每次 push 触发）

```
触发条件：push to master
执行内容：
  1. checkout 私有仓库代码
  2. rsync 排除 .privateignore 中列出的文件
  3. 将剩余文件推送到公开仓库的 master 分支
  4. commit message 与原始提交一致
```

**结果**：公开仓库同步更新（不含核心文件）

### Workflow 2：`publish.yml`（打 tag 触发）

```
触发条件：push tag v*
执行内容：
  1. checkout 私有仓库代码
  2. npm install
  3. npm run build（esbuild 编译 + 混淆）
  4. npx vsce package（打包 .vsix）
  5. npx ovsx publish（发布到 OpenVSX）
  6. 在公开仓库创建 GitHub Release + 上传 .vsix
```

**结果**：
- OpenVSX 上出现新版本（用户可通过 IDE 直接安装）
- 公开仓库 Releases 页面出现新版本 + .vsix 下载

---

## 步骤六：验证发布结果

等待约 2-3 分钟后，检查以下内容：

### 1. OpenVSX（插件市场）

```
https://open-vsx.org/extension/neo1027144/antigravity-history
```

确认版本号已更新。

### 2. GitHub Release（公开仓库）

```
https://github.com/neo1027144-creator/antigravity-history-vscode/releases
```

确认新版本的 Release 已创建，`.vsix` 文件已上传。

### 3. 公开仓库代码同步

```
https://github.com/neo1027144-creator/antigravity-history-vscode
```

确认最新 commit 已同步，commit message 与私有仓库一致。

### 4. 命令行快速验证

```bash
# 检查 OpenVSX 版本
curl -s https://open-vsx.org/api/neo1027144/antigravity-history/latest | python -c "import sys,json;print(json.load(sys.stdin)['version'])"

# 检查 GitHub Release
curl -s https://api.github.com/repos/neo1027144-creator/antigravity-history-vscode/releases/latest | python -c "import sys,json;print(json.load(sys.stdin)['tag_name'])"
```

---

## 完整命令汇总（一键发版）

假设你已经完成了代码修改和版本号更新：

```bash
# 1. 提交
git add -A
git commit -m "feat: v0.1.8 - 描述"

# 2. 打 Tag
git tag v0.1.8

# 3. 推送（触发自动化）
git push origin master --tags

# 4. 等待 2-3 分钟后验证
```

就这四步，CI/CD 自动完成剩下的所有工作。

---

## 故障排查

### CI/CD 没有触发
- 检查 tag 格式是否为 `v*`（如 `v0.1.8`）
- 在私有仓库的 Actions 页面查看 Workflow 运行状态

### OpenVSX 发布失败
- 检查 `OVSX_TOKEN` 是否过期
- 在 Actions 日志中查看具体错误

### GitHub Release 未创建
- 检查 `PUBLIC_REPO_TOKEN` 权限（需要 Contents: read/write）
- 确认 token 未过期

### 公开仓库同步失败
- 检查 `PUBLIC_REPO_TOKEN` 是否有 push 权限
- 查看 sync-public.yml 的 Actions 日志

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `.github/workflows/publish.yml` | 发布到 OpenVSX + 创建 GitHub Release |
| `.github/workflows/sync-public.yml` | 同步到公开仓库 |
| `.privateignore` | 同步时排除的私有文件列表 |
| `esbuild.js` | 构建 + 混淆配置 |
| `DUAL_REPO_GUIDE.md` | 双仓库架构完整指南 |
