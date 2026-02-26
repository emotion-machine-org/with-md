"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const editor_provider_1 = require("./editor-provider");
function activate(context) {
    context.subscriptions.push(editor_provider_1.WithMdEditorProvider.register(context));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map