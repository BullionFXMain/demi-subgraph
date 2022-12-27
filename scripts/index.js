"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var child_process_1 = require("child_process");
var dotenv = require("dotenv");
var path = require("path");
var fs = require("fs");
var commander_1 = require("commander");
dotenv.config();
/**
 * Execute Child Processes
 * @param cmd Command to execute
 * @returns The command ran it
 */
var exec = function (cmd) {
    var srcDir = path.join(__dirname, "..");
    try {
        return (0, child_process_1.execSync)(cmd, { cwd: srcDir, stdio: "inherit" });
    }
    catch (e) {
        throw new Error("Failed to run command `".concat(cmd, "`"));
    }
};
/**
 * Write a file
 * @param _path Location of the file
 * @param file The file
 */
// eslint-disable-next-line
var writeFile = function (_path, file) {
    try {
        fs.writeFileSync(_path, file);
    }
    catch (error) {
        console.log(error);
    }
};
/**
 * Check the endpoint where the subgraph will be deployed. If default is used, will return TheGraph endpoint
 * `https://api.thegraph.com/deploy/`. In other case, user should check the endpoint and function just will
 * check the slash at the end of the endpoint
 * @param endpoint The desired endpoint. Set `default` is want to use the TheGraph endpoint.
 * @returns The checked endpoint
 */
var checkEndpoint = function (endpoint) {
    if (endpoint === "default" || "") {
        return "--node https://api.thegraph.com/deploy/";
    }
    else {
        return "--node ".concat(endpoint.slice(-1) === "/" ? endpoint : endpoint + "/");
    }
};
var checkIpfsEndpoint = function (endpoint) {
    if (endpoint === "default" || endpoint === "") {
        return "";
    }
    else {
        return "--ipfs ".concat(endpoint);
    }
};
var createLabel = function (label) {
    if (label === "default" || label === "") {
        return "";
    }
    else {
        return "--version-label ".concat(label);
    }
};
var main = function () { return __awaiter(void 0, void 0, void 0, function () {
    var options, _config, _subgraphName, _endpoint, _ipfsEndpoint, _versionLabel, _subgraphTemplate;
    return __generator(this, function (_a) {
        commander_1.program
            .requiredOption("--config <string>", "Path to JSON file with the addresess and chain to deploy.")
            .requiredOption("--subgraphName <string>", "The subgraph name to deploy. Eg: 'user/name'.")
            .option("--versionLabel <string>", "The subgraph version label that will be append.", "")
            .option("--endpoint <string>", "The URL that will be use to deploy the subgraph.", "https://api.thegraph.com/deploy/")
            .option("--ipfsEndpoint <string>", "The URL that will be use with IPFS.", "")
            .option("--subgraphTemplate <string>", "Specify a path to a another differente yaml file to be used as template. By the default use the root template.", "subgraph.template.yaml");
        commander_1.program.parse();
        options = commander_1.program.opts();
        _config = options.config;
        _subgraphName = options.subgraphName;
        _endpoint = checkEndpoint(options.endpoint);
        _ipfsEndpoint = checkIpfsEndpoint(options.ipfsEndpoint);
        _versionLabel = createLabel(options.versionLabel);
        _subgraphTemplate = options.subgraphTemplate;
        // Add the address to the subgraph.yaml file
        exec("npx mustache ".concat(_config, " ").concat(_subgraphTemplate, " subgraph.yaml"));
        // Generate all teh SG code
        exec("npm run generate-schema && npm run codegen && npm run build");
        // This create the graph node with the endpoint and subgraph name to be used locally
        if (_endpoint.includes("localhost") || _endpoint.includes("127.0.0.1")) {
            exec("npx graph create ".concat(_endpoint, " ").concat(_subgraphName));
        }
        // Deploy the Subgraph
        exec("npx graph deploy ".concat(_endpoint, " ").concat(_ipfsEndpoint, " ").concat(_subgraphName, " ").concat(_versionLabel));
        return [2 /*return*/];
    });
}); };
main()
    .then(function () {
    var exit = process.exit;
    exit(0);
})["catch"](function (error) {
    console.error(error);
    var exit = process.exit;
    exit(1);
});
