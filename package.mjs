import {packager} from '@electron/packager';
const paths=await packager({dir:'.',name:'TypeWriter',out:'release',...(process.env.ANCUO_ELECTRON_ZIP_DIR?{electronZipDir:process.env.ANCUO_ELECTRON_ZIP_DIR}:{}),platform:process.platform,arch:process.arch,overwrite:true,asar:true,prune:true,appBundleId:'top.ancuo.writer',appCategoryType:'public.app-category.productivity',ignore:[/^\/release(?:\/|$)/,/^\/src(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/\.git(?:\/|$)/,/^\/(?:build|package)\.mjs$/]});
console.log(paths.join('\n'));
