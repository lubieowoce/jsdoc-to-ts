export type Tagged1<T> = T & {
  __tag?: "tagged";
};

function afterTypedef1() {
  return 3 as Tagged1<number>;
}

export type Tagged2<T> = T & {
  __tag?: "tagged";
};

export function afterTypedef2() {
  return 3 as Tagged2<number>;
}

//==========================================

function beforeInnerFunctionDecl() {
  type InnerTagged<T> = T & {
    __tag?: "tagged";
  };

  function afterTypedef2(x: number) {
    return x as InnerTagged<number>;
  }
}

function beforeInnerArrowFunction() {
  type InnerTagged<T> = T & {
    __tag?: "tagged";
  };

  const afterTypedef2 = () => {
    return 3 as InnerTagged<number>;
  };
}

function beforeInnerFunctionExpr() {
  type InnerTagged<T> = T & {
    __tag?: "tagged";
  };

  const afterTypedef2 = function () {
    return 3 as InnerTagged<number>;
  };
}
