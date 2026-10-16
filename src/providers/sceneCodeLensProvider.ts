/**
 * Scene CodeLens Provider
 * 在 Scene 类的 construct 方法显示 "▶ Run Scene" 按钮
 * 在 Scene 内的注释行显示 checkpoint_paste 按钮（带锁定状态）
 */

import * as vscode from 'vscode';
import { detectAllScenes } from '../python/sceneDetector';
import { checkpointState } from '../state/checkpointState';

export class SceneCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor() {
        // 监听状态变化，触发 CodeLens 刷新
        checkpointState.onDidChangeState(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    /**
     * 提供 CodeLens
     */
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        // 只处理 Python 文件
        if (document.languageId !== 'python') {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
        const scenes = detectAllScenes(document);
        const text = document.getText();
        const lines = text.split('\n');

        // 为每个 Scene 添加 CodeLens
        for (const scene of scenes) {
            // 1. 在 construct 方法上显示 "▶ Run Scene"
            const constructRange = new vscode.Range(scene.constructLineNumber, 0, scene.constructLineNumber, 0);
            codeLenses.push(new vscode.CodeLens(constructRange, {
                title: '▶ Run Scene',
                tooltip: `从头运行 ${scene.name}`,
                command: 'maningl-preview.runScene',
                arguments: [scene.constructLineNumber, scene.name],
            }));

            // 2. 检测 construct 方法内的注释行（只在 construct 方法体内）

            // 找到下一个 Scene 的起始行（用于确定当前 Scene 的范围）
            const sceneIndex = scenes.indexOf(scene);
            const nextSceneStart = sceneIndex < scenes.length - 1
                ? scenes[sceneIndex + 1].lineNumber
                : lines.length;

            // 获取 construct 方法的缩进级别（用于判断 construct 方法结束）
            const constructLine = lines[scene.constructLineNumber];
            const constructIndent = constructLine.match(/^(\s*)/)?.[1].length ?? 0;

            // 找到 construct 方法的结束行：
            // 遇到同级或更少缩进的 def / class / 装饰器行，或到 Scene 结束
            let constructEnd = nextSceneStart;
            const methodDefRegex = /^(\s*)(def\s|class\s|@)/;
            for (let i = scene.constructLineNumber + 1; i < nextSceneStart; i++) {
                const line = lines[i];
                if (line.trim() === '') { continue; } // 跳过空行
                const match = line.match(methodDefRegex);
                if (match) {
                    const indent = match[1].length;
                    if (indent <= constructIndent) {
                        constructEnd = i;
                        break;
                    }
                }
            }

            // construct 方法体内注释的缩进应该比 construct def 行更深
            const bodyIndentMin = constructIndent + 1;
            const commentRegex = /^(\s+)#\s*.+/;

            // 收集 construct 方法体内的注释行
            const commentLines: number[] = [];
            for (let i = scene.constructLineNumber + 1; i < constructEnd; i++) {
                const match = lines[i].match(commentRegex);
                if (match && match[1].length >= bodyIndentMin) {
                    commentLines.push(i);
                }
            }

            const totalCheckpoints = commentLines.length;
            const isSceneStarted = checkpointState.isSceneStarted(scene.name);

            // 为每个注释行创建 CodeLens
            for (let idx = 0; idx < commentLines.length; idx++) {
                const startLine = commentLines[idx];

                // 计算代码块结束行：到下一个注释行之前，或到 Scene 结束
                let endLine: number;
                if (idx < commentLines.length - 1) {
                    // 下一个注释行的前一行
                    endLine = commentLines[idx + 1] - 1;
                } else {
                    // 最后一个注释区块：到 Scene 结束前的最后一个非空行
                    endLine = nextSceneStart - 1;
                    // 跳过末尾的空行
                    while (endLine > startLine && lines[endLine].trim() === '') {
                        endLine--;
                    }
                }

                const lineCount = endLine - startLine + 1;
                const commentText = lines[startLine].trimStart();

                // 根据状态显示不同图标
                let title: string;
                let tooltip: string;
                let command: string;
                let args: (string | number)[];

                if (!isSceneStarted) {
                    // 场景未启动，显示 RunScene
                    title = '▶ Run Scene';
                    tooltip = `运行 ${scene.name} 后解锁 checkpoint`;
                    command = 'maningl-preview.runScene';
                    // 传递 checkpoint 行号用于 -se 参数，以及索引用于解锁
                    args = [startLine, scene.name, idx, totalCheckpoints];
                } else {
                    // 场景已启动，检查 checkpoint 状态
                    const isExecuted = checkpointState.isExecuted(scene.name, idx);
                    const isUnlocked = checkpointState.isUnlocked(scene.name, idx);

                    if (isExecuted) {
                        // 已执行
                        title = '✅ CheckpointPaste';
                        tooltip = `已执行: ${commentText} (${lineCount} lines) - 点击重新执行`;
                    } else if (isUnlocked) {
                        // 已解锁，可执行
                        title = '▶ CheckpointPaste';
                        tooltip = `checkpoint_paste: ${commentText} (${lineCount} lines)`;
                    } else {
                        // 锁定
                        title = '🔒 CheckpointPaste';
                        tooltip = `锁定: ${commentText} (${lineCount} lines) - 点击解锁`;
                    }
                    command = 'maningl-preview.runCheckpointFromComment';
                    args = [startLine, endLine, scene.name, idx, totalCheckpoints];
                }

                const range = new vscode.Range(startLine, 0, startLine, 0);
                codeLenses.push(new vscode.CodeLens(range, {
                    title,
                    tooltip,
                    command,
                    arguments: args,
                }));
            }
        }

        return codeLenses;
    }
}
