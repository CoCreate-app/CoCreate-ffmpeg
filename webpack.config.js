

const path = require("path")

const TerserPlugin = require("terser-webpack-plugin")
const MiniCssExtractPlugin = require("mini-css-extract-plugin")
const { CleanWebpackPlugin } = require("clean-webpack-plugin")

module.exports = (env, argv) => {
    let isProduction = false
    if (argv.mode === 'production')
        isProduction = true

    const config = {
        entry: {
            "CoCreate-ffmpeg": "./src/index.js",
        },
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: isProduction ? "[name].min.js" : "[name].js",
            libraryTarget: "umd",
            libraryExport: "default",
            library: ["CoCreate", "ffmpeg"],
            globalObject: "this",
        },
        experiments: {
            asyncWebAssembly: true,
            topLevelAwait: true,
        },

        plugins: [
            new CleanWebpackPlugin(),
            new MiniCssExtractPlugin({
                filename: "[name].css",
            }),
        ],

        mode: isProduction ? "production" : "development",
        module: {
            rules: [
                {
                    test: /.js$/,
                    exclude: (modulePath) => {
                        // Additionally, exclude `CoCreate-ffmpeg.js` file
                        if (/ffmpeg/.test(modulePath)) {
                            return true;
                        }
                        // Include all other .js files
                        return false;
                    },
                    use: {
                        loader: "babel-loader",
                        options: {
                            plugins: ["@babel/plugin-transform-modules-commonjs"],
                        },
                    },
                },
                {
                    test: /.css$/i,
                    use: [
                        { loader: "style-loader", options: { injectType: "linkTag" } },
                        "file-loader",
                    ],
                },
            ],
        },

        // add source map
        ...(isProduction ? {} : { devtool: "eval-source-map" }),

        optimization: {
            minimize: true,
            minimizer: [
                new TerserPlugin({
                    extractComments: true,
                    // cache: true,
                    parallel: true,
                    // sourceMap: true, // Must be set to true if using source-maps in production
                    terserOptions: {
                        // https://github.com/webpack-contrib/terser-webpack-plugin#terseroptions
                        // extractComments: 'all',
                        compress: {
                            drop_console: true,
                        },
                    },
                }),
            ],
            // splitChunks: {
            //     chunks: "all",
            //     minSize: 200,
            //     // maxSize: 99999,
            //     //minChunks: 1,

            //     cacheGroups: {
            //         defaultVendors: false,
            //     },
            // },
        },
    }
    return config
}