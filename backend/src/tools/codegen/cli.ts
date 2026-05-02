/**
 * 代码生成工具CLI
 */

import { Command } from 'commander';
import { generateCodeFile, CodeGenOptions } from './CodeGenerator';

const program = new Command();

program.name('codegen').description('代码生成工具').version('1.0.0');

program
  .command('generate')
  .description('生成代码文件')
  .option(
    '-t, --template <template>',
    '模板类型: class, interface, function, enum, type',
    'class'
  )
  .option('-n, --name <name>', '名称', 'MyClass')
  .option('-o, --output <output>', '输出文件路径', 'src/generated/MyClass.ts')
  .option('-d, --description <description>', '描述')
  .option('--export <export>', '导出类型: default, named', 'named')
  .option('--extends <extends>', '继承的类')
  .option('--implements <implements>', '实现的接口，多个接口用逗号分隔')
  .option('--jsdoc', '生成JSDoc注释', false)
  .action(async (options) => {
    const codeGenOptions: CodeGenOptions = {
      outputPath: options.output,
      template: options.template as any,
      name: options.name,
      description: options.description,
      exportType: options.export,
      extends: options.extends,
      implements: options.implements?.split(','),
      generateJSDoc: options.jsdoc,
      properties: [],
      methods: [],
      enumValues: [],
    };

    try {
      await generateCodeFile(codeGenOptions);
      console.log('代码生成成功！');
    } catch (error) {
      console.error('代码生成失败:', error);
      process.exit(1);
    }
  });

program
  .command('class')
  .description('生成类文件')
  .option('-n, --name <name>', '类名', 'MyClass')
  .option('-o, --output <output>', '输出文件路径', 'src/generated/MyClass.ts')
  .option('-d, --description <description>', '类描述')
  .option('--export <export>', '导出类型: default, named', 'named')
  .option('--extends <extends>', '继承的类')
  .option('--implements <implements>', '实现的接口，多个接口用逗号分隔')
  .option('--jsdoc', '生成JSDoc注释', false)
  .action(async (options) => {
    const codeGenOptions: CodeGenOptions = {
      outputPath: options.output,
      template: 'class',
      name: options.name,
      description: options.description,
      exportType: options.export,
      extends: options.extends,
      implements: options.implements?.split(','),
      generateJSDoc: options.jsdoc,
      properties: [],
      methods: [],
    };

    try {
      await generateCodeFile(codeGenOptions);
      console.log('类文件生成成功！');
    } catch (error) {
      console.error('类文件生成失败:', error);
      process.exit(1);
    }
  });

program
  .command('interface')
  .description('生成接口文件')
  .option('-n, --name <name>', '接口名', 'MyInterface')
  .option(
    '-o, --output <output>',
    '输出文件路径',
    'src/generated/MyInterface.ts'
  )
  .option('-d, --description <description>', '接口描述')
  .option('--export <export>', '导出类型: default, named', 'named')
  .option('--extends <extends>', '继承的接口')
  .option('--jsdoc', '生成JSDoc注释', false)
  .action(async (options) => {
    const codeGenOptions: CodeGenOptions = {
      outputPath: options.output,
      template: 'interface',
      name: options.name,
      description: options.description,
      exportType: options.export,
      extends: options.extends,
      generateJSDoc: options.jsdoc,
      properties: [],
      methods: [],
    };

    try {
      await generateCodeFile(codeGenOptions);
      console.log('接口文件生成成功！');
    } catch (error) {
      console.error('接口文件生成失败:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);
